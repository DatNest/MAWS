/** MAWS Universal · Native — per-chat lifecycle and prompt bridge. */
const DATA_KEY = 'maws_engine_universal_v1';
const LEGACY_KEY = 'maws_engine_avatar_v1';
const PROMPT_ID = 'MAWS_UNIVERSAL_DIRECTOR';
const PANEL_ID = 'maws-native-settings';
const ENGINE_BUILD = '2.4.4';

const state = {
  running: false,
  available: true,
  loadNumber: 0,
  pending: Promise.resolve(),
  error: '',
  observer: null,
  eventBus: null,
  eventName: null,
};

function getContext() {
  try { return SillyTavern.getContext(); }
  catch { return null; }
}

function currentScope(c = getContext()) {
  if (!c?.chatMetadata || !Array.isArray(c.chat)) return '';
  const chatId = c.getCurrentChatId?.();
  return chatId == null ? '' : [c.characterId, c.groupId, chatId].join('|');
}

function isEnabled(c = getContext()) {
  return !!currentScope(c) && c.chatMetadata[DATA_KEY]?.enabled === true;
}

function updateToggle(c, enabled) {
  if (!currentScope(c)) return false;
  // One canonical source of truth, stored with the chat and preserved by JSONL export.
  // If this is an old avatar-version chat, keep all old data on first edit.
  const previous = c.chatMetadata[DATA_KEY] ?? c.chatMetadata[LEGACY_KEY] ?? { version: 43 };
  c.chatMetadata[DATA_KEY] = { ...previous, enabled: !!enabled };
  return true;
}

// SillyTavern's saveMetadata writes the current JSONL chat. Start the write
// while this chat is active and wait for it before completing the toggle.
async function saveEnabledForChat(c, enabled) {
  if (!currentScope(c) || !updateToggle(c, enabled)) return false;
  if (typeof c.saveMetadata !== 'function') {
    throw new Error('SillyTavern не предоставил saveMetadata()');
  }
  await c.saveMetadata();
  return true;
}

function panelHost() {
  return document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
}

function renderPanel() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  const c = getContext(), valid = !!currentScope(c), enabled = isEnabled(c);
  const input = panel.querySelector('#maws-native-enabled');
  if (input) { input.checked = enabled; input.disabled = !valid || panel.dataset.loading === 'true' || panel.dataset.saving === 'true'; }
  const open = panel.querySelector('[data-maws-open]');
  if (open) open.disabled = !valid || !enabled || !state.running;
  const note = panel.querySelector('[data-maws-status]');
  if (note) {
    note.textContent = state.error ? `Ошибка: ${state.error}` : !valid ? 'Открой чат, чтобы изменить его настройки.' :
      panel.dataset.saving === 'true' ? 'Сохраняю выбор в чате…' :
      panel.dataset.loading === 'true' ? 'Применяю настройки чата…' :
      enabled && state.running ? 'Включён только в этом чате' : enabled ? 'Ожидает запуска движка' :
      'Выключен только в этом чате';
  }
}

function mountPanel() {
  if (document.getElementById(PANEL_ID)) { renderPanel(); return true; }
  const host = panelHost();
  if (!host) return false;
  const panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.className = 'maws-native-settings inline-drawer';
  panel.innerHTML = `
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>MAWS <span class="maws-native-subtitle">Universal</span></b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down" aria-hidden="true"></div>
    </div>
    <div class="inline-drawer-content maws-native-body">
      <div class="maws-native-eyebrow">Ролевой движок · 2.4.4</div>
      <label class="maws-native-switch" for="maws-native-enabled">
        <input id="maws-native-enabled" type="checkbox" role="switch" aria-describedby="maws-native-hint">
        <span class="maws-native-switch-track" aria-hidden="true"></span>
        <span class="maws-native-switch-label"><b>Включить MAWS в этом чате</b><small>В других чатах режим не изменится</small></span>
      </label>
      <div id="maws-native-hint" class="maws-native-status" data-maws-status role="status" aria-live="polite"></div>
      <div class="maws-native-actions"><button type="button" class="maws-native-open" data-maws-open>Открыть панель MAWS</button></div>
      <p class="maws-native-note">Оформление, цвета, промпты, задания и переключатель сохраняются в метаданных этой ролевой. Кэш остаётся в памяти браузера; отдельные копии чатов не создаются.</p>
    </div>`;
  panel.addEventListener('change', event => {
    if (event.target?.id !== 'maws-native-enabled') return;
    const c = getContext(), enabled = !!event.target.checked;
    if (!currentScope(c)) { renderPanel(); return; }
    panel.dataset.saving = 'true';
    renderPanel();
    // Do not treat an in-flight write as saved. In particular, do not let a
    // subsequent engine render mask a save error while the page is reloading.
    void saveEnabledForChat(c, enabled).then(saved => {
      if (saved) { state.error = ''; return reconcile(); }
    }).catch(error => {
      state.error = 'Не удалось сохранить настройки чата: ' + String(error?.message ?? error);
      console.error('[MAWS] Toggle save:', error);
    }).finally(() => {
      panel.dataset.saving = 'false';
      renderPanel();
    });
  });
  panel.querySelector('[data-maws-open]')?.addEventListener('click', () => {
    if (!window.__MAWS_NATIVE_BRIDGE__?.openPanel?.()) {
      const note = panel.querySelector('[data-maws-status]');
      if (note) note.textContent = 'Нужен хотя бы один ответ персонажа в чате.';
    }
  });
  host.appendChild(panel);
  renderPanel();
  return true;
}

function setLoading(loading) {
  const panel = document.getElementById(PANEL_ID);
  if (panel) panel.dataset.loading = String(loading);
  renderPanel();
}

async function clearPrompt() {
  try { await getContext()?.setExtensionPrompt?.(PROMPT_ID, '', -1, 0, false, 0); }
  catch (error) { console.warn('[MAWS] Prompt cleanup:', error); }
}

async function startEngine() {
  if (state.running) return;
  // The engine itself uses chatMetadata; its UI is lazily mounted on rendered messages.
  const token = ++state.loadNumber;
  // Versioned URL stays cacheable across reloads. The counter only changes when
  // the package itself is stopped and started, never for ordinary chat switches.
  await import(`./engine.js?native=${ENGINE_BUILD}-${token}`);
  if (!window.__MAWS_NATIVE_BRIDGE__ || typeof window.__mawsUniversalCleanup !== 'function') {
    throw new Error('Движок не создал подключение к SillyTavern');
  }
  state.running = true;
}

async function stopEngine() {
  const cleanup = window.__mawsUniversalCleanup;
  try { if (typeof cleanup === 'function') await cleanup(); }
  catch (error) { console.warn('[MAWS] Engine cleanup:', error); }
  state.running = false;
  await clearPrompt();
}

function reconcile() {
  setLoading(true);
  // Keep the engine mounted across per-chat ON/OFF changes. Re-importing a
  // 400+ KB script and reattaching every listener on each chat switch was
  // the primary lifecycle cost. In an OFF chat its prompt/UI still clear.
  state.pending = state.pending.catch(() => {}).then(async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const wanted = state.available && isEnabled();
        if (!state.available) {
          if (state.running) await stopEngine();
          else await clearPrompt();
        } else if (wanted && !state.running) {
          await startEngine();
        } else if (!state.running) {
          await clearPrompt();
        }
        if (state.running) {
          await window.__MAWS_NATIVE_BRIDGE__?.syncPrompt?.();
          // ON/OFF toggles must repaint even while the engine remains warm.
          window.__MAWS_NATIVE_BRIDGE__?.refresh?.();
        }
        // Check again after async import/cleanup or prompt sync, since the chat
        // can change during any of those operations.
        if ((state.available && isEnabled()) === wanted && (state.available || !state.running)) break;
      }
      state.error = '';
    } catch (error) {
      state.error = String(error?.message ?? error).slice(0, 220);
      console.error('[MAWS] Initialization:', error);
      if (state.running || window.__mawsUniversalCleanup) await stopEngine();
    } finally { setLoading(false); }
  });
  return state.pending;
}

// SillyTavern invokes this interceptor on normal generation requests.
window.MAWSNativeBeforeGeneration = async function (_chat, _contextSize, _abort, type) {
  if (['quiet', 'impersonate'].includes(String(type ?? '').toLowerCase())) return;
  const scope = currentScope();
  if (!scope || !state.available) return;
  if (!isEnabled()) {
    // A warm engine may still be mounted while this chat is OFF. Ensure its
    // prompt is blank before any ordinary generation in the disabled chat.
    await state.pending;
    if (state.running) await window.__MAWS_NATIVE_BRIDGE__?.syncPrompt?.();
    return;
  }
  if (!state.running) await reconcile();
  else await state.pending;
  if (scope !== currentScope() || !state.running || !isEnabled()) return;
  await window.__MAWS_NATIVE_BRIDGE__?.syncPrompt?.();
};

// Disabling the extension package must not overwrite any per-chat ON/OFF choice.
export async function onDisable() {
  state.available = false;
  await reconcile();
}
export async function onEnable() {
  state.available = true;
  await reconcile();
}

async function initialize() {
  if (!mountPanel()) {
    state.observer = new MutationObserver(() => {
      if (mountPanel()) { state.observer.disconnect(); state.observer = null; }
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }
  const c = getContext();
  if (c?.eventSource && c?.event_types?.CHAT_CHANGED) {
    state.eventBus = c.eventSource;
    state.eventName = c.event_types.CHAT_CHANGED;
    state.eventBus.on(state.eventName, () => { renderPanel(); void reconcile(); });
  }
  window.addEventListener('maws:enabled-changed', () => { renderPanel(); void reconcile(); });
  await reconcile();
}
void initialize().catch(error => console.error('[MAWS] Startup:', error));
