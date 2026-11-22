import base64
import socket
import unittest
from unittest.mock import patch

from lumi_safari import Blocked, Controller, ELEMENT, LABEL_FIELD, OBSERVE, current_source, public_website


MODEL = 'TestModel01'
PROJECT = '12'
PHOTO = 'https://app.companycam.com/projects/12/photos/123/photo'


class FakeDriver:
    def __init__(self):
        self.session = None
        self.windows = {'one': 'about:blank'}
        self.current = 'one'
        self.calls = []
        self.image = b'\x89PNG\r\n\x1a\nfake'
        self.label = ''
        self.hits = True
        self.delivery_failed = False
        self.frame_mode = 'editor'

    def start(self):
        self.session = 'session'

    def close(self):
        self.session = None

    def command(self, method, route, body=None):
        self.calls.append((method,route,body))
        if route == '/url':
            if method=='GET':
                return self.windows[self.current]
            self.windows[self.current]=body['url']
        elif route == '/window/handles':
            return list(self.windows)
        elif route == '/window':
            if method=='GET':
                return self.current
            self.current=body['handle']
        elif route == '/window/new':
            handle='tab'+str(len(self.windows))
            self.windows[handle]='about:blank'
            return {'handle':handle}
        elif route == '/screenshot':
            return base64.b64encode(self.image).decode()
        elif route == '/execute/sync':
            script=body['script']
            if script == OBSERVE:
                return {'viewport':{'width':800,'height':600},'frames':[{
                    'mode':self.frame_mode,'labelCount':1,'framePath':[0],'activeTools':['Select'],
                    'hits':self.hits,'target':{'x':200,'y':100} if body['args'][2] else None}]}
            if LABEL_FIELD in script:
                return {'element':{ELEMENT:'label'},'label':self.label}
            if "querySelectorAll('iframe')" in script:
                return {ELEMENT:'frame'}
            if 'scrollBy' in script:
                return body['args'][0]
            raise AssertionError(script)
        elif route=='/element/label/value':
            self.label=body['text'].split('\ue000')[1].rstrip('\ue004')
        elif route=='/actions' and method=='POST' and self.delivery_failed:
            raise Blocked('uncertain')
        elif route not in ('/actions','/refresh','/frame'):
            raise AssertionError(route)


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.driver=FakeDriver()
        self.ctrl=Controller(self.driver,PROJECT,MODEL)
        self.ctrl.dispatch({'action':'open','source':'editor'})

    def req(self,action,**kw):
        return self.ctrl.dispatch({'action':action,**kw})

    def gesture(self,kind='click',op='one',**kw):
        args={'ref':self.req('snapshot')['ref'],'operationId':op,'evidencia':PHOTO,'x':30,'y':60}
        return self.req(kind,**{**args,**kw})

    def test_scope_and_navigation(self):
        for url in ['https://my.matterport.com/models/OtherModel0', 'http://my.matterport.com/models/'+MODEL,
                    'https://my.matterport.com/show/?m='+MODEL+'&m=OtherModel0','https://app.companycam.com/projects/120',
                    'https://my.matterport.com.evil.test/work?m='+MODEL]:
            self.assertIsNone(current_source(url,PROJECT,MODEL))
        self.req('open',source='tour')
        self.req('open',source='editor')
        self.assertEqual(len(self.driver.windows),2)
        editor_navigations=[c for c in self.driver.calls if c[:2]==('POST','/url') and '/work?' in c[2]['url']]
        self.assertEqual(len(editor_navigations),1)
        self.req('refresh')
        self.assertIn(('POST','/refresh',{}),self.driver.calls)

    def test_click_drag_and_mouse_move(self):
        self.assertFalse(self.gesture()['verificado'])
        self.gesture('drag','two',hastaX=80,hastaY=120)
        self.gesture('move','three')
        payloads=[v['actions'][0]['actions'] for m,r,v in self.driver.calls if r=='/actions' and m=='POST']
        self.assertEqual([action['type'] for action in payloads[0]],['pointerMove','pointerDown','pointerUp'])
        self.assertEqual([action['type'] for action in payloads[1]],['pointerMove','pointerDown','pointerMove','pointerUp'])
        self.assertEqual(payloads[1][2]['x'],80)
        self.assertEqual([action['type'] for action in payloads[2]],['pointerMove'])

    def test_stale_duplicate_outside_wrong_evidence(self):
        ref=self.req('snapshot')['ref']
        self.driver.image+=b'different'
        with self.assertRaises(Blocked): self.gesture(ref=ref)
        with self.assertRaises(Blocked): self.gesture(evidencia=PHOTO.replace('/12/','/13/'))
        self.driver.hits=False
        with self.assertRaises(Blocked): self.gesture()
        self.driver.hits=True
        self.gesture()
        with self.assertRaises(Blocked): self.gesture()
        self.assertEqual(len([c for c in self.driver.calls if c[1]=='/actions']),1)

    def test_uncertain_drag_releases_input_and_consumes_id(self):
        self.driver.delivery_failed=True
        with self.assertRaises(Blocked): self.gesture('drag',hastaX=100,hastaY=120)
        self.assertIn(('DELETE','/actions',None),self.driver.calls)
        self.driver.delivery_failed=False
        with self.assertRaises(Blocked): self.gesture('drag',hastaX=100,hastaY=120)

    def test_tool_and_label(self):
        with self.assertRaises(Blocked): self.gesture('tool',name='Delete')
        self.assertEqual(self.gesture('tool',name='Wall')['estado'],'gesto_enviado')
        self.assertEqual(self.req('readLabel')['label'],'')
        with self.assertRaises(Blocked): self.gesture('writeLabel','two',before='Other',after='Laundry Room')
        with self.assertRaises(Blocked): self.gesture('writeLabel','two',before='',after='A\ue03d')
        result=self.gesture('writeLabel','two',before='',after='Laundry Room')
        self.assertEqual(result['label'],'Laundry Room')
        self.assertFalse(result['verificado'])
        self.assertEqual(self.driver.calls[-1],('POST','/frame',{'id':None}))

    def test_only_public_site_and_no_actions_on_websites(self):
        public=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34',443))]
        with patch('socket.getaddrinfo',return_value=public):
            self.req('open',source='website',url='https://example.org')
            self.assertEqual(self.req('scroll',deltaY=200)['deltaY'],200)
            with self.assertRaises(Blocked): self.req('snapshot')
            with self.assertRaises(Blocked): self.gesture('click')
            with self.assertRaises(Blocked): self.req('readLabel')
            self.driver.windows[self.driver.current]='https://other.site/'
            with self.assertRaises(Blocked): self.req('scroll',deltaY=10)
        with patch('socket.getaddrinfo',return_value=[(socket.AF_INET,1,6,'',('127.0.0.1',443))]):
            for u in ['https://host.example','http://example.org','https://user:pass@example.org','https://example.org:81']:
                with self.assertRaises(Blocked): public_website(u)


if __name__=='__main__':
    unittest.main()
