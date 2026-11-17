"""Browser-level smoke test with a mocked SillyTavern context (not a live ST server)."""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from functools import partial
from playwright.sync_api import sync_playwright

folder=Path(__file__).resolve().parents[1]
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(folder)))
thread=Thread(target=server.serve_forever,daemon=True);thread.start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--allow-file-access-from-files'])
  page=browser.new_page(viewport={'width':1150,'height':780})
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  html=(folder/'tests'/'fixture.html').read_text(encoding='utf-8').replace('<script type="module" src="../index.js"></script>','')
  page.set_content(html,wait_until='load')
  page.add_script_tag(content=(folder/'engine.js').read_text(encoding='utf-8'))
  page.wait_for_function("document.querySelectorAll('#chat .mw-panel').length >= 1",timeout=30000)
  mounted=page.locator('#chat .mw-panel').count()
  assert mounted<30,f'Lazy renderer mounted {mounted} / 60 assistant panels'
  before=page.evaluate('window.mockLogs.prompts.at(-1)?.[0]')
  assert before=='chat-A',before
  page.locator('#chat').evaluate('(el)=>el.scrollTop=el.scrollHeight/2')
  page.wait_for_timeout(500)
  middle=page.locator('#chat .mw-panel').count()
  assert middle>mounted, f'Old panels are not populated when visible ({mounted}->{middle})'
  page.evaluate("window.mockSwitch('chat-B')")
  page.wait_for_function("window.mockLogs.prompts.at(-1)?.[0]==='chat-B'",timeout=10000)
  assert page.locator('#chat .mw-panel').count()>=1
  page.evaluate('window.mockEdited()')
  page.wait_for_timeout(450)
  assert not errors, 'Browser errors: '+str(errors[:4])
  print(f'PASS: mocked Chromium bootstrap, lazy render ({mounted}->{middle}), per-chat prompt, edited message, no browser errors')
  browser.close()
finally:
 server.shutdown()
