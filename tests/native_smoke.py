"""Browser smoke: independent per-chat lifecycle, prompt, theme, storage."""
from pathlib import Path
from playwright.sync_api import sync_playwright

folder = Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width':1280,'height':850})
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    html = (folder/'tests/native_fixture.html').read_text('utf-8').replace('<script type="module" src="../index.js"></script>', '')
    page.set_content(html, wait_until='load')
    page.add_style_tag(content=(folder/'style.css').read_text('utf-8'))
    engine = (folder/'engine.js').read_text('utf-8')
    page.evaluate('(code)=>window.__MAWS_ENGINE_SOURCE__=code', engine)
    index = (folder/'index.js').read_text('utf-8')
    index = index.replace('export async function onDisable()', 'async function onDisable()')
    index = index.replace('export async function onEnable()', 'async function onEnable()')
    index = index.replace('await import(`./engine.js?native=${ENGINE_BUILD}-${token}`);', 'new Function(window.__MAWS_ENGINE_SOURCE__)();')
    page.add_script_tag(content=index)
    page.wait_for_selector('#maws-native-enabled', timeout=10000)
    toggle=page.locator('#maws-native-enabled')
    assert not toggle.is_checked()
    assert not page.evaluate('window.mockLogs.prompts.some(row=>row[2])'), 'unexpected initial prompt'
    assert page.evaluate("typeof window.MAWSNativeBeforeGeneration")=='function'

    # A: enabled; carries its own prompt and theme.
    toggle.evaluate('(el)=>{el.checked=true;el.dispatchEvent(new Event("change",{bubbles:true}))}')
    page.wait_for_function("window.mockLogs.prompts.some(x=>x[0]==='chat-A'&&x[2]?.includes('CHAT_A_SPECIFIC_PROMPT'))", timeout=30000)
    assert page.evaluate("window.mockStore['chat-A'].maws_engine_universal_v1.enabled") is True
    assert page.evaluate("window.mockStore['chat-A'].maws_engine_universal_v1.theme.panel")=='#4b3844'
    theme_a=page.evaluate("document.getElementById('maws-user-colors-v13')?.textContent")
    assert theme_a and '--maws-color-0:' in theme_a
    page.wait_for_function("document.querySelectorAll('#chat .mw-panel').length>0", timeout=20000)
    assert page.locator('#chat .mw-panel').count()<30
    # The latest MAWS card starts as a compact bar, not as a hidden full UI.
    assert page.locator('#chat .mw-panel .mw-compact-toggle[aria-expanded="false"]').count()>0
    assert page.locator('#chat .mw-panel .mw-expanded').count()==0
    # Explicit click builds its content and another click folds it back.
    latest_card=page.locator('#chat .mw-panel').last
    latest_card.locator('.mw-compact-toggle').click()
    page.wait_for_function('document.querySelectorAll("#chat .mw-panel .mw-expanded").length>0')
    latest_card.locator('.mw-compact-toggle').click()
    page.wait_for_function('document.querySelectorAll("#chat .mw-panel .mw-expanded").length===0')
    count=page.evaluate('window.mockLogs.prompts.length')
    page.evaluate("window.MAWSNativeBeforeGeneration([],2048,()=>{},'quiet')")
    assert page.evaluate('window.mockLogs.prompts.length')==count

    # B starts OFF regardless of A; prompt and UI must clear.
    page.evaluate("window.mockSwitch('chat-B')")
    page.wait_for_function("!document.querySelector('#maws-native-enabled').checked && !!window.__MAWS_NATIVE_BRIDGE__", timeout=30000)
    page.wait_for_function("window.mockLogs.prompts.at(-1)[2]===''", timeout=20000)
    assert not page.evaluate("window.mockStore['chat-B'].maws_engine_universal_v1.enabled===true")
    assert page.locator('#chat .mw-panel').count()==0
    # Moving to a disabled chat keeps the package loaded; only chat UI/prompt clear.
    assert page.evaluate('!!window.__MAWS_NATIVE_BRIDGE__')

    # Enable B independently; it must never receive A's custom prompt.
    toggle.evaluate('(el)=>{el.checked=true;el.dispatchEvent(new Event("change",{bubbles:true}))}')
    page.wait_for_function("window.mockLogs.prompts.some(x=>x[0]==='chat-B'&&x[2]?.includes('CHAT_B_SPECIFIC_PROMPT'))", timeout=30000)
    last=page.evaluate('window.mockLogs.prompts.at(-1)')
    assert 'CHAT_A_SPECIFIC_PROMPT' not in last[2], 'cross-chat prompt contamination'
    assert page.evaluate("window.mockStore['chat-B'].maws_engine_universal_v1.theme.panel")=='#384a5b'
    theme_b=page.evaluate("document.getElementById('maws-user-colors-v13')?.textContent")
    assert theme_b and theme_a!=theme_b, 'the same palette leaked across chats'
    assert page.evaluate("window.mockStore['chat-B'].maws_engine_universal_v1.enabled") is True

    # Explicitly disable B; A remains enabled and its profile is retained.
    toggle.evaluate('(el)=>{el.checked=false;el.dispatchEvent(new Event("change",{bubbles:true}))}')
    page.wait_for_function("document.querySelector('#maws-native-enabled').checked===false && !!window.__MAWS_NATIVE_BRIDGE__", timeout=30000)
    assert page.evaluate("window.mockStore['chat-B'].maws_engine_universal_v1.enabled") is False
    page.evaluate("window.mockSwitch('chat-A')")
    page.wait_for_function("document.querySelector('#maws-native-enabled').checked && !!window.__MAWS_NATIVE_BRIDGE__", timeout=30000)
    page.evaluate("window.MAWSNativeBeforeGeneration([],2048,()=>{},'normal')")
    page.wait_for_function("window.mockLogs.prompts.at(-1)[0]==='chat-A' && window.mockLogs.prompts.at(-1)[2]?.includes('CHAT_A_SPECIFIC_PROMPT')", timeout=15000)
    assert page.evaluate("window.mockStore['chat-A'].maws_engine_universal_v1.enabled") is True
    assert page.evaluate("window.mockStore['chat-A'].maws_engine_universal_v1.theme.panel")=='#4b3844'
    theme_a=page.evaluate("document.getElementById('maws-user-colors-v13')?.textContent")
    assert theme_a and '--maws-color-0:' in theme_a

    # Revisit B; still off. Disabling the package must not erase A's preference.
    page.evaluate("window.mockSwitch('chat-B')")
    page.wait_for_function("!document.querySelector('#maws-native-enabled').checked && !!window.__MAWS_NATIVE_BRIDGE__", timeout=30000)
    assert page.evaluate('window.mockLogs.saves')>=2
    assert not errors, errors[:5]
    print('PASS: A ON/B OFF, A/B theme and prompt isolated, OFF cleanup, same-chat return persistence, quiet request, bounded visible panels')
    browser.close()
