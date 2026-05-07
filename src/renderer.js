// ===== 状态管理 =====
let conversations = [];
let models = [];
let settings = { theme: 'dark', systemPrompt: '你是一个有帮助的AI助手。' };
let currentConvId = null;
let isStreaming = false;
let abortController = null;

// ===== 模型预设 =====
const PRESETS = {
  deepseek:      { name: 'DeepSeek-V4-Flash', endpoint: 'https://api.deepseek.com/chat/completions', modelId: 'deepseek-v4-flash' },
  deepseek_pro:  { name: 'DeepSeek-V4-Pro',   endpoint: 'https://api.deepseek.com/chat/completions', modelId: 'deepseek-v4-pro' },
  openai:        { name: 'GPT-4o',             endpoint: 'https://api.openai.com/v1/chat/completions', modelId: 'gpt-4o' },
  claude:        { name: 'Claude',             endpoint: 'https://api.anthropic.com/v1/messages', modelId: 'claude-sonnet-4-20250514' },
  glm:           { name: 'GLM-4',              endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', modelId: 'glm-4' },
  qwen:          { name: '通义千问',            endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', modelId: 'qwen-turbo' },
  moonshot:      { name: 'Moonshot',            endpoint: 'https://api.moonshot.cn/v1/chat/completions', modelId: 'moonshot-v1-8k' },
  groq:          { name: 'Groq',                endpoint: 'https://api.groq.com/openai/v1/chat/completions', modelId: 'llama-3.3-70b-versatile' },
  ollama:        { name: 'Ollama',              endpoint: 'http://localhost:11434/v1/chat/completions', modelId: 'llama3' },
};

function applyPreset() {
  const key = document.getElementById('me-preset').value;
  if (!key) return;
  const p = PRESETS[key];
  document.getElementById('me-name').value = p.name;
  document.getElementById('me-endpoint').value = p.endpoint;
  document.getElementById('me-model').value = p.modelId;
  if (key === 'ollama') document.getElementById('me-key').value = 'ollama';
}

// ===== 主题 =====
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  settings.theme = theme;
}
function toggleTheme() {
  const next = settings.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  saveSettingsToDisk();
}

// ===== 自定义确认弹窗 =====
function showConfirm(msg) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-msg">${msg}</div>
        <div class="confirm-actions">
          <button class="cancel-btn">取消</button>
          <button class="danger-btn">删除</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.cancel-btn').onclick = () => { document.body.removeChild(overlay); resolve(false); };
    overlay.querySelector('.danger-btn').onclick = () => { document.body.removeChild(overlay); resolve(true); };
    overlay.addEventListener('click', e => { if (e.target === overlay) { document.body.removeChild(overlay); resolve(false); } });
  });
}

// ===== 对话编辑弹窗 =====
let editingConvId = null;
function editConversation(id, e) {
  e.stopPropagation();
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  editingConvId = id;
  // 填充模型列表
  const sel = document.getElementById('ce-model');
  sel.innerHTML = models.length === 0
    ? '<option value="">请先添加模型</option>'
    : models.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  if (conv.modelId) sel.value = conv.modelId;
  // 填充提示词
  document.getElementById('ce-prompt').value = conv.systemPrompt || '';
  openModal('conv-edit-modal');
}

// ===== 初始化 =====
async function init() {
  conversations = await window.api.loadConversations() || [];
  models = await window.api.loadModels() || [];
  const loadedSettings = await window.api.loadSettings() || {};
  settings = { ...settings, ...loadedSettings };
  applyTheme(settings.theme || 'dark');

  models.forEach(m => {
    if (m.temperature === undefined) m.temperature = 0.7;
    if (m.maxTokens === undefined) m.maxTokens = 128000;
    if (m.topP === undefined) m.topP = 1;
    if (m.contextLength === undefined) m.contextLength = 0;
  });

  renderConversationList();
  updateModelSelect();

  document.getElementById('new-chat-btn').addEventListener('click', newConversation);

  document.getElementById('send-btn').addEventListener('click', sendMessage);
  document.getElementById('user-input').addEventListener('keydown', handleInputKeydown);
  document.getElementById('user-input').addEventListener('input', autoResize);
  document.getElementById('settings-btn').addEventListener('click', () => openModal('settings-modal'));
  document.getElementById('add-model-btn').addEventListener('click', () => editModel(-1));
  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
  document.getElementById('ce-save').addEventListener('click', saveConvEdit);

  // 标题栏拖拽（IPC 方式，彻底解决输入框失焦）
  initTitlebarDrag();

  if (conversations.length > 0) selectConversation(conversations[0].id);
}

// ===== 标题栏拖拽 =====
function initTitlebarDrag() {
  const dragEl = document.querySelector('.titlebar-drag');
  let dragging = false;
  dragEl.addEventListener('mousedown', async (e) => {
    if (e.button !== 0) return;
    dragging = true;
    await window.api.dragStart({ x: e.screenX, y: e.screenY });
    const onMove = async (ev) => {
      if (!dragging) return;
      await window.api.dragMove({ x: ev.screenX, y: ev.screenY });
    };
    const onUp = async () => {
      dragging = false;
      await window.api.dragEnd();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  // 双击最大化
  dragEl.addEventListener('dblclick', () => window.api.windowMaximize());
}

// ===== 对话管理 =====
function newConversation() {
  const conv = {
    id: Date.now().toString(),
    title: '新对话',
    messages: [],
    modelId: models.length > 0 ? models[0].id : null,
    systemPrompt: '',
    draftInput: '',
    createdAt: Date.now(),
  };
  conversations.unshift(conv);
  selectConversation(conv.id);
  // 让新对话项播放入场动画
  const newEl = document.querySelector(`.conv-item[onclick*="${conv.id}"]`);
  if (newEl) { newEl.classList.remove('no-anim'); newEl.style.animationDelay = '0s'; }
  saveConversations();
}

function selectConversation(id) {
  if (currentConvId) {
    const oldConv = getConv();
    if (oldConv) oldConv.draftInput = document.getElementById('user-input').value;
  }
  currentConvId = id;
  renderConversationList(true);
  const conv = getConv();
  if (!conv) return;
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('chat-area').style.display = 'flex';
  document.getElementById('chat-title').textContent = conv.title;
  const input = document.getElementById('user-input');
  input.value = conv.draftInput || '';
  autoResize.call(input);
  renderMessages();
}

async function deleteConversation(id, e) {
  e.stopPropagation();
  const conv = conversations.find(c => c.id === id);
  const title = conv ? conv.title : '此对话';
  const confirmed = await showConfirm(`确定删除「${escapeHtml(title)}」？<br>删除后无法恢复。`);
  if (!confirmed) return;
  // 播放滑出动画
  const el = document.querySelector(`.conv-item[onclick*="${id}"]`);
  if (el) {
    el.classList.add('removing');
    await new Promise(r => setTimeout(r, 250));
  }
  conversations = conversations.filter(c => c.id !== id);
  if (currentConvId === id) {
    currentConvId = null;
    document.getElementById('empty-state').style.display = 'flex';
    document.getElementById('chat-area').style.display = 'none';
  }
  renderConversationList(true);
  saveConversations();
}

function getConv() { return conversations.find(c => c.id === currentConvId); }
async function saveConversations() { await window.api.saveConversations(conversations); }
async function saveModels() { await window.api.saveModels(models); }
async function saveSettingsToDisk() { await window.api.saveSettings(settings); }

// ===== 渲染 =====
let batchMode = false;
let allSelected = false;
function renderConversationList(skipAnim) {
  const list = document.getElementById('conversation-list');
  list.innerHTML = conversations.map((c, i) => `
    <div class="conv-item ${c.id === currentConvId ? 'active' : ''} ${batchMode ? 'batch-mode' : ''} ${skipAnim ? 'no-anim' : ''}" onclick="${batchMode ? `toggleBatchItem('${c.id}', this)` : `selectConversation('${c.id}')`}" style="${skipAnim ? '' : `animation-delay: ${Math.min(i * 0.03, 0.3)}s`}">
      <div class="conv-check" data-id="${c.id}" onclick="event.stopPropagation(); toggleBatchItem('${c.id}', this.parentElement)" ${batchMode ? '' : 'style="display:none"'}><img src="../icons/对话未选中.png"></div>
      <span class="conv-title">${escapeHtml(c.title)}</span>
      <div class="conv-actions">
        <button class="conv-edit" onclick="editConversation('${c.id}', event)" title="编辑"><img src="../icons/编辑.png" style="width:14px;height:14px"></button>
        <button class="conv-delete" onclick="deleteConversation('${c.id}', event)" title="删除"><img src="../icons/删除.png" style="width:14px;height:14px"></button>
      </div>
    </div>
  `).join('');
}

function renderMessages() {
  const conv = getConv();
  if (!conv) return;
  const container = document.getElementById('messages');
  container.innerHTML = conv.messages
    .filter(m => m.role !== 'system')
    .map(m => {
      const avatar = m.role === 'user' ? '👤' : '🤖';
      if (m.role === 'user') {
        return `<div class="msg user"><div class="msg-avatar">${avatar}</div><div class="msg-bubble">${escapeHtml(m.content)}</div></div>`;
      }
      let thinkingHtml = '';
      if (m.thinking) thinkingHtml = renderThinkingBlock(m.thinking);
      const contentHtml = renderMarkdown(m.content || '');
      return `<div class="msg assistant"><div class="msg-avatar">${avatar}</div><div class="msg-content">${thinkingHtml}<div class="msg-bubble">${contentHtml}</div></div></div>`;
    }).join('');
  container.scrollTop = container.scrollHeight;
}

function renderThinkingBlock(text) {
  const id = 'think-' + Math.random().toString(36).slice(2, 8);
  return `<div class="thinking-block">
    <div class="thinking-toggle" onclick="toggleThinking('${id}', this)">
      <span class="arrow collapsed">▼</span>
      <span class="label">思考过程</span>
    </div>
    <div id="${id}" class="thinking-content hidden">${escapeHtml(text)}</div>
  </div>`;
}

function toggleThinking(id, toggleEl) {
  const el = document.getElementById(id);
  const arrow = toggleEl.querySelector('.arrow');
  if (el.classList.contains('hidden')) {
    el.classList.remove('hidden');
    arrow.classList.remove('collapsed');
    arrow.classList.add('expanded');
  } else {
    el.classList.add('hidden');
    arrow.classList.remove('expanded');
    arrow.classList.add('collapsed');
  }
}

function updateModelSelect() {
  // no-op: model selector removed from chat header
}

async function saveConvEdit() {
  const conv = conversations.find(c => c.id === editingConvId);
  if (!conv) return;
  conv.modelId = document.getElementById('ce-model').value;
  conv.systemPrompt = document.getElementById('ce-prompt').value;
  await saveConversations();
  closeModal('conv-edit-modal');
}

// ===== 发送消息 =====
async function sendMessage() {
  if (isStreaming) { stopStream(); return; }
  const input = document.getElementById('user-input');
  const text = input.value.trim();
  if (!text) return;
  const conv = getConv();
  if (!conv) return;
  const model = models.find(m => m.id === conv.modelId);
  if (!model) { alert('请先选择或添加一个模型'); return; }

  conv.messages.push({ role: 'user', content: text });
  input.value = '';
  conv.draftInput = '';
  autoResize.call(input);

  // 构建请求消息（受最大上下文轮数限制）
  const sysPrompt = conv.systemPrompt || settings.systemPrompt;
  const reqMessages = [];
  if (sysPrompt) reqMessages.push({ role: 'system', content: sysPrompt });
  const allMsgs = conv.messages.filter(m => m.role === 'user' || m.role === 'assistant');
  const maxRounds = model.contextLength || 0;
  let contextMsgs = allMsgs;
  if (maxRounds > 0 && allMsgs.length > maxRounds * 2) {
    contextMsgs = allMsgs.slice(-maxRounds * 2);
  }
  contextMsgs.forEach(m => reqMessages.push({ role: m.role, content: m.content }));

  conv.messages.push({ role: 'assistant', content: '', thinking: '' });
  const aiIdx = conv.messages.length - 1;
  renderMessages();
  showTyping();

  isStreaming = true;
  updateSendBtn();
  abortController = new AbortController();

  const needsThinking = model.modelId && (model.modelId.includes('pro') || model.modelId.includes('reasoner'));

  try {
    const bodyObj = {
      model: model.modelId,
      messages: reqMessages,
      stream: true,
      temperature: model.temperature,
      max_tokens: model.maxTokens,
      top_p: model.topP,
    };
    if (needsThinking) {
      bodyObj.thinking = { type: 'enabled' };
      bodyObj.reasoning_effort = 'high';
    }

    const res = await fetch(model.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${model.apiKey}` },
      body: JSON.stringify(bodyObj),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API错误 ${res.status}: ${err}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') break;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.reasoning_content) conv.messages[aiIdx].thinking += delta.reasoning_content;
          if (delta.content) conv.messages[aiIdx].content += delta.content;
          updateLastMessage(conv.messages[aiIdx]);
        } catch {}
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      conv.messages[aiIdx].content = `❌ 错误: ${err.message}`;
      updateLastMessage(conv.messages[aiIdx]);
    }
  } finally {
    isStreaming = false;
    abortController = null;
    updateSendBtn();
    saveConversations();
    // 流结束后自动生成标题
    autoGenerateTitle(conv, model);
  }
}

// ===== 自动生成对话标题 =====
async function autoGenerateTitle(conv, model) {
  // 标题已经是自定义的就不重复生成
  if (conv.title !== '新对话') return;
  const userMsgs = conv.messages.filter(m => m.role === 'user');
  if (userMsgs.length === 0) return;
  if (!model) { console.log('[autoTitle] no model'); return; }
  // 收集最近几轮对话内容用于生成标题
  const recentMessages = conv.messages.slice(-8);
  const dialogText = recentMessages.map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.slice(0, 300)}`).join('\n');
  console.log('[autoTitle] generating for conv:', conv.id, 'model:', model.name, 'endpoint:', model.endpoint);

  try {
    const res = await fetch(model.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${model.apiKey}` },
      body: JSON.stringify({
        model: model.modelId,
        messages: [
          { role: 'system', content: '根据以下对话内容，生成一个简短的对话标题，不超过20个字。只返回标题文本，不要加引号或其他任何标记。' },
          { role: 'user', content: dialogText },
        ],
        temperature: 0.3,
        max_tokens: 50,
        stream: false,
      }),
    });
    console.log('[autoTitle] response status:', res.status);
    if (!res.ok) return;
    const data = await res.json();
    let title = data.choices?.[0]?.message?.content?.trim();
    if (title) {
      title = title.replace(/^["""'']+|["""'']+$/g, '').trim();
      if (title.length > 30) title = title.slice(0, 30) + '...';
      conv.title = title;
      document.getElementById('chat-title').textContent = title;
      renderConversationList(true);
      saveConversations();
    }
  } catch (err) {
    console.log('[autoTitle] error:', err.message);
  }
}

function stopStream() { if (abortController) abortController.abort(); }

function updateSendBtn() {
  const btn = document.getElementById('send-btn');
  if (isStreaming) { btn.title = '停止'; btn.style.background = 'var(--danger)'; btn.innerHTML = '■'; btn.style.fontSize = '16px'; }
  else { btn.title = '发送'; btn.style.background = ''; btn.style.fontSize = ''; btn.innerHTML = '<img src="../icons/确认.png" style="width:22px;height:22px">'; }
}

function updateLastMessage(msg) {
  const msgs = document.getElementById('messages');
  const lastMsg = msgs.querySelector('.msg.assistant:last-child');
  if (!lastMsg) return;

  let thinkingEl = lastMsg.querySelector('.thinking-block');
  if (msg.thinking) {
    const newHtml = renderThinkingBlock(msg.thinking);
    if (thinkingEl) thinkingEl.outerHTML = newHtml;
    else lastMsg.querySelector('.msg-content').insertAdjacentHTML('afterbegin', newHtml);
  }

  const bubble = lastMsg.querySelector('.msg-bubble');
  if (bubble) {
    if (msg.content) bubble.innerHTML = renderMarkdown(msg.content);
    else if (msg.thinking) bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  }
  msgs.scrollTop = msgs.scrollHeight;
}

function showTyping() {
  const msgs = document.getElementById('messages');
  const lastBubble = msgs.querySelector('.msg.assistant:last-child .msg-bubble');
  if (lastBubble && !lastBubble.textContent.trim()) {
    lastBubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  }
}

// ===== 输入处理 =====
function handleInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}
function autoResize() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 160) + 'px';
}

// ===== 模型管理 =====
let editingModelIdx = -1;

function renderModelList() {
  const list = document.getElementById('model-list');
  list.innerHTML = models.map((m, i) => `
    <div class="model-item">
      <div class="model-info">
        <div class="model-name">${escapeHtml(m.name)}</div>
        <div class="model-detail">${escapeHtml(m.modelId)} · 创意度=${m.temperature ?? 0.7} · 回复长度=${m.maxTokens ?? 128000} · 上下文=${m.contextLength ?? 0}轮 · ${maskKey(m.apiKey)}</div>
      </div>
      <div class="model-actions">
        <button onclick="editModel(${i})" title="编辑" class="icon-btn icon-sm"><img src="../icons/编辑.png"></button>
        <button class="del-btn icon-btn icon-sm" onclick="deleteModel(${i})" title="删除"><img src="../icons/删除.png"></button>
      </div>
    </div>
  `).join('');
}

function editModel(idx) {
  editingModelIdx = idx;
  const m = idx >= 0 ? models[idx] : null;
  document.getElementById('me-preset').value = '';
  document.getElementById('me-name').value = m ? m.name : '';
  document.getElementById('me-endpoint').value = m ? m.endpoint : '';
  document.getElementById('me-key').value = m ? m.apiKey : '';
  document.getElementById('me-model').value = m ? m.modelId : '';
  document.getElementById('me-temp').value = m ? (m.temperature ?? 0.7) : 0.7;
  document.getElementById('me-tokens').value = m ? (m.maxTokens ?? 128000) : 128000;
  document.getElementById('me-ctx').value = m ? (m.contextLength ?? 0) : 0;
  document.getElementById('me-topp').value = m ? (m.topP ?? 1) : 1;
  document.getElementById('advanced-params').classList.add('advanced-hidden');
  document.getElementById('model-edit-title').textContent = m ? '编辑模型' : '添加模型';
  openModal('model-edit-modal');

  document.getElementById('me-save').onclick = async () => {
    const name = document.getElementById('me-name').value.trim();
    const endpoint = document.getElementById('me-endpoint').value.trim();
    const apiKey = document.getElementById('me-key').value.trim();
    const modelId = document.getElementById('me-model').value.trim();
    const temperature = parseFloat(document.getElementById('me-temp').value) || 0.7;
    const maxTokens = parseInt(document.getElementById('me-tokens').value) || 128000;
    const contextLength = parseInt(document.getElementById('me-ctx').value) || 0;
    const topP = parseFloat(document.getElementById('me-topp').value) || 1;
    if (!name || !endpoint || !modelId) { alert('请填写名称、API地址和模型ID'); return; }
    const modelObj = { id: m ? m.id : Date.now().toString(), name, endpoint, apiKey, modelId, temperature, maxTokens, contextLength, topP };
    if (idx >= 0) models[idx] = modelObj; else models.push(modelObj);
    await saveModels();
    renderModelList();
    updateModelSelect();
    closeModal('model-edit-modal');
  };
}

async function deleteModel(idx) {
  if (!confirm('确定删除此模型？')) return;
  models.splice(idx, 1);
  await saveModels();
  renderModelList();
  updateModelSelect();
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

// ===== 侧边栏 =====
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('collapsed'); }

// ===== 批量删除 =====
function enterBatchMode() {
  batchMode = true;
  allSelected = false;
  document.getElementById('batch-btn').style.display = 'none';
  document.getElementById('batch-close-btn').style.display = '';
  document.getElementById('batch-selectall-btn').style.display = '';
  document.getElementById('batch-delete-btn').style.display = '';
  renderConversationList(true);
}
function exitBatchMode() {
  batchMode = false;
  allSelected = false;
  document.getElementById('batch-btn').style.display = '';
  document.getElementById('batch-close-btn').style.display = 'none';
  document.getElementById('batch-selectall-btn').style.display = 'none';
  document.getElementById('batch-delete-btn').style.display = 'none';
  // reset select-all button icon
  document.getElementById('batch-selectall-btn').title = '全选';
  document.getElementById('batch-selectall-btn').innerHTML = '<img src="../icons/全选.png">';
  renderConversationList(true);
}
function toggleBatchItem(id, el) {
  const check = el.querySelector('.conv-check');
  const isSelected = check.dataset.selected === 'true';
  if (isSelected) {
    check.dataset.selected = 'false';
    check.innerHTML = '<img src="../icons/对话未选中.png">';
  } else {
    check.dataset.selected = 'true';
    check.innerHTML = '<img src="../icons/对话被选中.png">';
  }
}
function toggleSelectAll() {
  const checks = document.querySelectorAll('.conv-check');
  if (!allSelected) {
    checks.forEach(ch => { ch.dataset.selected = 'true'; ch.innerHTML = '<img src="../icons/对话被选中.png">'; });
    allSelected = true;
    document.getElementById('batch-selectall-btn').title = '取消全选';
    document.getElementById('batch-selectall-btn').innerHTML = '<img src="../icons/取消全选.png">';
  } else {
    checks.forEach(ch => { ch.dataset.selected = 'false'; ch.innerHTML = '<img src="../icons/对话未选中.png">'; });
    allSelected = false;
    document.getElementById('batch-selectall-btn').title = '全选';
    document.getElementById('batch-selectall-btn').innerHTML = '<img src="../icons/全选.png">';
  }
}
async function batchDelete() {
  const checkedIds = [...document.querySelectorAll('.conv-check[data-selected="true"]')].map(ch => ch.dataset.id);
  if (checkedIds.length === 0) { return; }
  const confirmed = await showConfirm(`确定删除选中的 ${checkedIds.length} 个对话？<br>删除后无法恢复。`);
  if (!confirmed) return;
  // 播放滑出动画
  checkedIds.forEach(id => {
    const el = document.querySelector(`.conv-item[onclick*="${id}"]`);
    if (el) el.classList.add('removing');
  });
  await new Promise(r => setTimeout(r, 250));
  conversations = conversations.filter(c => !checkedIds.includes(c.id));
  if (checkedIds.includes(currentConvId)) {
    currentConvId = null;
    document.getElementById('empty-state').style.display = 'flex';
    document.getElementById('chat-area').style.display = 'none';
  }
  renderConversationList(true);
  saveConversations();
  // 删完自动退出批量模式
  exitBatchMode();
}

// ===== 弹窗 =====
function openModal(id) {
  document.getElementById(id).style.display = 'flex';
  if (id === 'model-modal') renderModelList();
  if (id === 'export-modal') renderExportConvList();
}
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
document.addEventListener('click', e => { if (e.target.classList.contains('modal')) e.target.style.display = 'none'; });

// ===== 高级参数折叠 =====
function toggleAdvancedParams() {
  document.getElementById('advanced-params').classList.toggle('advanced-hidden');
}

// ===== 导出聊天记录 =====
function renderExportConvList() {
  const sel = document.getElementById('ex-conv');
  sel.innerHTML = conversations.length === 0
    ? '<option value="">暂无对话</option>'
    : conversations.map(c => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join('');
  document.getElementById('ex-save').onclick = doExport;
}

function doExport() {
  const convId = document.getElementById('ex-conv').value;
  const format = document.getElementById('ex-format').value;
  const conv = conversations.find(c => c.id === convId);
  if (!conv) { alert('请选择一个对话'); return; }

  let content, mimeType, ext;
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${conv.title}_${dateStr}`;

  switch (format) {
    case 'html':
      content = generateExportHTML(conv);
      mimeType = 'text/html'; ext = 'html'; break;
    case 'txt':
      content = generateExportTXT(conv);
      mimeType = 'text/plain'; ext = 'txt'; break;
    case 'md':
      content = generateExportMD(conv);
      mimeType = 'text/markdown'; ext = 'md'; break;
    case 'json':
      content = JSON.stringify({
        title: conv.title, createdAt: new Date(conv.createdAt).toISOString(),
        systemPrompt: conv.systemPrompt || '',
        messages: conv.messages.map(m => ({ role: m.role, content: m.content, thinking: m.thinking || '' }))
      }, null, 2);
      mimeType = 'application/json'; ext = 'json'; break;
  }

  const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${filename}.${ext}`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  closeModal('export-modal');
}

function generateExportHTML(conv) {
  const msgs = conv.messages.filter(m => m.role !== 'system');
  const bodyHtml = msgs.map(m => {
    const isUser = m.role === 'user';
    const label = isUser ? '你' : 'AI';
    const bgColor = isUser ? '#6c5ce7' : '#f0f0f5';
    const textColor = isUser ? '#fff' : '#222';
    const align = isUser ? 'right' : 'left';
    let thinkingHtml = '';
    if (m.thinking) {
      thinkingHtml = `<details style="margin-bottom:8px"><summary style="cursor:pointer;color:#888;font-size:13px">思考过程</summary><div style="padding:8px 12px;font-size:13px;color:#888;background:#f8f8fc;border-radius:6px;white-space:pre-wrap">${escapeHtml(m.thinking)}</div></details>`;
    }
    return `<div style="margin-bottom:16px;text-align:${align}">
      <div style="font-size:12px;color:#999;margin-bottom:4px">${label}</div>
      ${thinkingHtml}
      <div style="display:inline-block;max-width:75%;padding:10px 14px;border-radius:12px;background:${bgColor};color:${textColor};white-space:pre-wrap;word-break:break-word;text-align:left;font-size:14px;line-height:1.6">${isUser ? escapeHtml(m.content) : renderMarkdown(m.content || '')}</div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(conv.title)} - AI Chat 导出</title>
<style>
body { font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; max-width: 800px; margin: 0 auto; padding: 24px; background: #fafafa; color: #222; }
h1 { font-size: 22px; margin-bottom: 4px; }
.meta { font-size: 13px; color: #999; margin-bottom: 24px; }
hr { border: none; border-top: 1px solid #eee; margin: 20px 0; }
pre { background: #f4f4f8; padding: 12px; border-radius: 8px; overflow-x: auto; }
code { background: #f0f0f5; padding: 2px 5px; border-radius: 3px; font-size: 13px; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; margin: 8px 0; }
th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
th { background: #f4f4f8; }
blockquote { border-left: 3px solid #6c5ce7; padding-left: 12px; color: #666; }
</style>
</head>
<body>
<h1>${escapeHtml(conv.title)}</h1>
<div class="meta">导出时间: ${new Date().toLocaleString('zh-CN')}</div>
<hr>
${bodyHtml}
</body>
</html>`;
}

function generateExportTXT(conv) {
  const msgs = conv.messages.filter(m => m.role !== 'system');
  const lines = [`对话: ${conv.title}`, `导出时间: ${new Date().toLocaleString('zh-CN')}`, '─'.repeat(50), ''];
  for (const m of msgs) {
    if (m.thinking) { lines.push('[思考过程]'); lines.push(m.thinking); lines.push('[/思考过程]'); }
    lines.push(m.role === 'user' ? '【你】' : '【AI】');
    lines.push(m.content || '');
    lines.push('');
  }
  return lines.join('\n');
}

function generateExportMD(conv) {
  const msgs = conv.messages.filter(m => m.role !== 'system');
  const lines = [`# ${conv.title}`, '', `> 导出时间: ${new Date().toLocaleString('zh-CN')}`, '', '---', ''];
  for (const m of msgs) {
    if (m.thinking) { lines.push('<details><summary>思考过程</summary>', '', m.thinking, '', '</details>', ''); }
    lines.push(m.role === 'user' ? '**你**:' : '**AI**:');
    lines.push('', m.content || '', '', '---', '');
  }
  return lines.join('\n');
}

// ===== Markdown 渲染 =====
function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="lang-${lang || 'text'}">${code}</code></pre>`);
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h2 style="font-size:20px">$1</h2>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  html = html.replace(/^(\|.+\|)\n(\|[\s\-:|]+\|)\n((?:\|.+\|\n?)*)/gm, (match, header, sep, body) => {
    const headers = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map(row => `<tr>${row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('')}</tr>`).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  });
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[2-4]>)/g, '$1');
  html = html.replace(/(<\/h[2-4]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<table>)/g, '$1');
  html = html.replace(/(<\/table>)<\/p>/g, '$1');
  html = html.replace(/<p>(<hr>)<\/p>/g, '$1');
  html = html.replace(/<p>(<blockquote>)/g, '$1');
  html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
  return html;
}

// ===== 工具函数 =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== 启动 =====
init();
