import { useState, useEffect } from 'react';
import type { APIConfig, Message, Post, Agent } from './types';
import { DEFAULT_AGENTS, AgentManager, PERSONALITY_PROMPTS } from './logic/AgentManager';
import { LLMService } from './services/LLMService';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './index.css';

interface CommentProps {
  message: Message;
  allMessages: Message[];
  onReply: (parentId: string) => void;
  isOrchestrating: boolean;
  agents: Agent[];
}

function Comment({ message, allMessages, onReply, isOrchestrating, agents }: CommentProps) {
  const agent = agents.find(a => `u/${a.name}` === message.author);

  return (
    <div className="comment" style={{ marginTop: '12px', paddingLeft: '16px', borderLeft: '2px solid #edeff1' }}>
      {message.isTyping ? (
        <div className="typing-indicator">{message.author} is typing...</div>
      ) : (
        <>
          <div className="comment-author" style={{ color: agent?.color }}>{message.author}</div>
          <div className="comment-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
            {message.attachment && (
              <div className="attachment-block" style={{ marginTop: '8px', padding: '8px', backgroundColor: 'var(--bg-secondary)', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--reddit-blue)', fontWeight: 'bold' }}>
                    View Attachment ({Math.round(message.attachment.length / 1024)} KB)
                  </summary>
                  <pre style={{ marginTop: '8px', fontSize: '0.8rem', whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: '300px' }}>
                    {message.attachment}
                  </pre>
                </details>
              </div>
            )}
          </div>
          <div style={{ marginTop: '4px' }}>
            <button
              onClick={() => onReply(message.id)}
              style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}
              disabled={isOrchestrating}
            >
              Reply
            </button>
          </div>
        </>
      )}
      <div className="replies">
        {allMessages.filter(m => m.parentId === message.id).map(reply => (
          <Comment
            key={reply.id}
            message={reply}
            allMessages={allMessages}
            onReply={onReply}
            isOrchestrating={isOrchestrating}
            agents={agents}
          />
        ))}
      </div>
    </div>
  );
}

function App() {
  // Config state
  const [config, setConfig] = useState<APIConfig>(() => {
    const saved = localStorage.getItem('llm_config');
    return saved ? JSON.parse(saved) : { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.1-mini' };
  });

  const [agents, setAgents] = useState<Agent[]>(() => {
    const saved = localStorage.getItem('llm_agents');
    return saved ? JSON.parse(saved) : DEFAULT_AGENTS;
  });

  // UI state
  const [activeTab, setActiveTab] = useState<'thread' | 'settings'>('thread');
  const [post, setPost] = useState<Post | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [showWelcomePopup, setShowWelcomePopup] = useState(false);

  // Input state
  const [contentInput, setContentInput] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<string | null>(null);
  const [lastAttachmentTag, setLastAttachmentTag] = useState<string | null>(null);

  const ATTACHMENT_THRESHOLD = 1000;

  const handlePaste = (e: React.ClipboardEvent) => {
    const pastedText = e.clipboardData.getData('text');
    if (pastedText.length > ATTACHMENT_THRESHOLD) {
      e.preventDefault();
      setPendingAttachment(pastedText);
      const lineCount = pastedText.split('\n').length;
      const tag = ` [Attached Text Content +${lineCount} lines]`;
      setLastAttachmentTag(tag);
      setContentInput(prev => prev + tag);
    }
  };

  // Persist config
  useEffect(() => {
    localStorage.setItem('llm_config', JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem('llm_agents', JSON.stringify(agents));
  }, [agents]);

  useEffect(() => {
    if (!config.apiKey) {
      setShowWelcomePopup(true);
    }
  }, []);

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveTab('thread');
  };

  const handleUpdateAgent = (index: number, updates: Partial<Agent>) => {
    const newAgents = [...agents];
    const updatedAgent = { ...newAgents[index], ...updates };

    if (updates.personalityType && updates.personalityType !== 'Custom (Manual Prompt)') {
      updatedAgent.role = PERSONALITY_PROMPTS[updates.personalityType].role;
    }

    newAgents[index] = updatedAgent;
    setAgents(newAgents);
  };

  const handleAddAgent = () => {
    const newAgent: Agent = {
      id: `agent_${Date.now()}`,
      name: 'New Agent',
      role: PERSONALITY_PROMPTS['Technical Expert'].role,
      color: '#' + Math.floor(Math.random() * 16777215).toString(16),
      personalityType: 'Technical Expert'
    };
    setAgents([...agents, newAgent]);
  };

  const handleRemoveAgent = (id: string) => {
    setAgents(agents.filter(a => a.id !== id));
  };

  const handleCreatePostOrReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contentInput) return;

    if (!config.apiKey) {
      setError('Please set your API API Key in Settings first.');
      setActiveTab('settings');
      return;
    }

    const newMessage: Message = {
      id: Date.now().toString(),
      author: 'u/User',
      role: 'user',
      content: contentInput,
      parentId: replyTarget,
      attachment: pendingAttachment || undefined
    };

    if (!post) {
      const newPost: Post = {
        id: newMessage.id,
        content: contentInput,
        author: 'u/User',
        createdAt: Date.now(),
        attachment: pendingAttachment || undefined
      };
      setPost(newPost);
      setMessages([newMessage]);
    } else {
      setMessages(prev => [...prev, newMessage]);
    }

    setContentInput('');
    setReplyTarget(null);
    setPendingAttachment(null);
    setLastAttachmentTag(null);
    setError(null);

    // Trigger orchestration
    runOrchestration(newMessage);
  };

  const getConversationThread = (targetMessage: Message, allMessages: Message[]): Message[] => {
    const thread: Message[] = [targetMessage];
    let current = targetMessage;
    while (current.parentId) {
      const parent = allMessages.find(m => m.id === current.parentId);
      if (parent) {
        thread.unshift(parent);
        current = parent;
      } else {
        break;
      }
    }
    return thread;
  };

  const runOrchestration = async (newestMessage: Message) => {
    setIsOrchestrating(true);

    try {
      const currentMessages = [...messages, newestMessage];
      let currentThread = getConversationThread(newestMessage, currentMessages);

      // 1. Router: Select the most suitable agent
      const routerPrompt = AgentManager.getRouterPrompt(newestMessage.content, agents);
      const selectedAgentName = await LLMService.call(config, [], routerPrompt);
      const firstAgent = agents.find(a => selectedAgentName.includes(a.name)) || agents[0];

      if (firstAgent) {
        // 2. First agent replies
        const firstReply = await handleAgentReply(firstAgent, currentThread, newestMessage.id, false);
        currentThread = [...currentThread, firstReply];

        // 3. Others reply to the conversation
        const remainingAgents = agents.filter(a => a.id !== firstAgent.id);
        for (const agent of remainingAgents) {
          const reply = await handleAgentReply(agent, currentThread, currentThread[currentThread.length - 1].id, true);
          currentThread = [...currentThread, reply];
        }
      }
    } catch (err: any) {
      setError(`Orchestration error: ${err.message}`);
    } finally {
      setIsOrchestrating(false);
    }
  };

  const handleAgentReply = async (agent: Agent, threadMessages: Message[], parentId: string, isFollowUp: boolean = false): Promise<Message> => {
    const typingId = `typing_${agent.id}_${Date.now()}`;
    setMessages(prev => [...prev, {
      id: typingId,
      author: agent.name,
      role: 'assistant',
      content: '',
      parentId,
      isTyping: true
    }]);

    try {
      const reply = await LLMService.call(config, threadMessages, AgentManager.getAgentPrompt(agent, isFollowUp), agent.model);

      const newReply: Message = {
        id: `msg_${agent.id}_${Date.now()}`,
        author: `u/${agent.name}`,
        role: 'assistant',
        content: reply,
        parentId,
      };

      setMessages(prev => prev.filter(m => m.id !== typingId).concat(newReply));
      await new Promise(r => setTimeout(r, 1000));
      return newReply;
    } catch (err: any) {
      setMessages(prev => prev.filter(m => m.id !== typingId));
      throw err;
    }
  };

  const handleReset = () => {
    setPost(null);
    setMessages([]);
    setError(null);
    setReplyTarget(null);
  };

  return (
    <div className="app-container">
      <header className="header">
        <a href="#" className="logo" onClick={(e) => { e.preventDefault(); setActiveTab('thread'); }}>
          r/RedditWithAgents
        </a>
        <nav style={{ marginLeft: 'auto', display: 'flex', gap: '16px' }}>
          <button
            style={{ fontWeight: activeTab === 'thread' ? 'bold' : 'normal', color: activeTab === 'thread' ? 'var(--reddit-orange)' : 'var(--text-secondary)' }}
            onClick={() => setActiveTab('thread')}
          >
            Home
          </button>
          <button
            style={{ fontWeight: activeTab === 'settings' ? 'bold' : 'normal', color: activeTab === 'settings' ? 'var(--reddit-orange)' : 'var(--text-secondary)' }}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </nav>
      </header>

      <main className="main-layout">
        <div className="content-area">
          {error && (
            <div className="card" style={{ borderColor: 'red', color: 'red', marginBottom: '16px' }}>
              {error}
            </div>
          )}

          {activeTab === 'settings' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="card">
                <h2 className="post-title" style={{ marginBottom: '16px' }}>Global API Settings</h2>
                <form onSubmit={handleSaveConfig}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>API Key</label>
                  <input
                    type="password"
                    className="input-field"
                    value={config.apiKey}
                    onChange={e => setConfig({ ...config, apiKey: e.target.value })}
                    placeholder="sk-..."
                    required
                  />
                  <div className="highlight-box" style={{ fontSize: '0.85rem' }}>
                    <strong>🔒 Privacy Note:</strong> All your configuration, including API keys and agent settings, are stored <strong>only</strong> in your browser's local storage. No data is sent to our servers except for the direct API calls to your configured LLM provider.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Base URL</label>
                      <input
                        type="text"
                        className="input-field"
                        value={config.baseUrl}
                        onChange={e => setConfig({ ...config, baseUrl: e.target.value })}
                        placeholder="https://api.openai.com/v1"
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Default Model</label>
                      <input
                        type="text"
                        className="input-field"
                        value={config.model}
                        onChange={e => setConfig({ ...config, model: e.target.value })}
                        placeholder="gpt-3.5-turbo"
                        required
                      />
                    </div>
                  </div>
                </form>
              </div>

              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h2 className="post-title" style={{ margin: 0 }}>Manage Agents</h2>
                  <button onClick={handleAddAgent} className="btn-primary" style={{ fontSize: '0.8rem' }}>+ Add Agent</button>
                </div>

                {agents.map((agent, index) => (
                  <div key={agent.id} style={{ padding: '16px', border: '1px solid var(--border-color)', borderRadius: '4px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <input
                        type="text"
                        className="input-field"
                        style={{ width: '40%', marginBottom: 0, fontWeight: 'bold' }}
                        value={agent.name}
                        onChange={e => handleUpdateAgent(index, { name: e.target.value })}
                        placeholder="Agent Name"
                      />
                      <button onClick={() => handleRemoveAgent(agent.id)} style={{ color: 'red', fontSize: '0.8rem' }}>Remove</button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
                      <div>
                        <label style={{ fontSize: '0.75rem' }}>Personality</label>
                        <select
                          className="input-field"
                          value={agent.personalityType}
                          onChange={e => handleUpdateAgent(index, { personalityType: e.target.value })}
                        >
                          {Object.keys(PERSONALITY_PROMPTS).map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem' }}>Model Override</label>
                        <input
                          type="text"
                          className="input-field"
                          value={agent.model || ''}
                          onChange={e => handleUpdateAgent(index, { model: e.target.value })}
                          placeholder="Global Default"
                        />
                      </div>
                    </div>

                    {agent.personalityType === 'Custom (Manual Prompt)' && (
                      <div>
                        <label style={{ fontSize: '0.75rem' }}>System Prompt</label>
                        <textarea
                          className="input-field"
                          style={{ minHeight: '80px' }}
                          value={agent.systemPrompt || ''}
                          onChange={e => handleUpdateAgent(index, { systemPrompt: e.target.value })}
                          placeholder="Define the behavior..."
                        />
                      </div>
                    )}
                  </div>
                ))}

                <button onClick={handleSaveConfig} className="btn-primary" style={{ width: '100%', marginTop: '8px' }}>Save All & Close</button>
              </div>
            </div>
          ) : (
            <>
              {!post ? (
                <div className="card">
                  <h2 className="post-title">Create a Post</h2>
                  <form onSubmit={handleCreatePostOrReply}>
                    <textarea
                      className="input-field"
                      style={{ minHeight: '120px', resize: 'vertical' }}
                      placeholder="What's on your mind?"
                      value={contentInput}
                      onChange={e => setContentInput(e.target.value)}
                      onPaste={handlePaste}
                      required
                    />
                    {pendingAttachment && (
                      <div style={{ marginBottom: '12px', fontSize: '0.8rem', color: 'var(--reddit-blue)' }}>
                        📎 Large text detected ({Math.round(pendingAttachment.length / 1024)} KB). It will be added as an attachment.
                        <button onClick={() => {
                          if (lastAttachmentTag) {
                            setContentInput(prev => prev.replace(lastAttachmentTag, ''));
                          }
                          setPendingAttachment(null);
                          setLastAttachmentTag(null);
                        }} style={{ marginLeft: '8px', color: 'red' }}>Remove</button>
                      </div>
                    )}
                    <button type="submit" className="btn-primary" disabled={isOrchestrating}>Post</button>
                  </form>
                </div>
              ) : (
                <div className="thread-view">
                  <div className="card">
                    <div className="post-meta">Posted by {post.author} • {new Date(post.createdAt).toLocaleTimeString()}</div>
                    <div className="post-content" style={{ fontSize: '1.2rem', fontWeight: 500 }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {post.content}
                      </ReactMarkdown>
                      {post.attachment && (
                        <div className="attachment-block" style={{ marginTop: '16px', padding: '12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                          <details>
                            <summary style={{ cursor: 'pointer', fontSize: '0.9rem', color: 'var(--reddit-blue)', fontWeight: 'bold' }}>
                              View Attachment ({Math.round(post.attachment.length / 1024)} KB)
                            </summary>
                            <pre style={{ marginTop: '10px', fontSize: '0.85rem', whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: '500px' }}>
                              {post.attachment}
                            </pre>
                          </details>
                        </div>
                      )}
                    </div>
                    <div style={{ marginTop: '12px', display: 'flex', gap: '12px' }}>
                      <button
                        onClick={() => setReplyTarget(messages[0].id)}
                        style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}
                        disabled={isOrchestrating}
                      >
                        Reply
                      </button>
                      <button onClick={handleReset} style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Delete Post & Restart</button>
                    </div>
                  </div>

                  {replyTarget && (
                    <div className="card" style={{ marginTop: '16px', border: '1px solid var(--reddit-blue)' }}>
                      <div style={{ fontSize: '0.8rem', marginBottom: '8px', color: 'var(--reddit-blue)', fontWeight: 'bold' }}>
                        Replying to {messages.find(m => m.id === replyTarget)?.author}
                      </div>
                      <form onSubmit={handleCreatePostOrReply}>
                        <textarea
                          className="input-field"
                          autoFocus
                          placeholder="Your reply..."
                          value={contentInput}
                          onChange={e => setContentInput(e.target.value)}
                          onPaste={handlePaste}
                          required
                        />
                        {pendingAttachment && (
                          <div style={{ marginBottom: '12px', fontSize: '0.8rem', color: 'var(--reddit-blue)' }}>
                            📎 Large text detected ({Math.round(pendingAttachment.length / 1024)} KB). It will be added as an attachment.
                            <button onClick={() => {
                              if (lastAttachmentTag) {
                                setContentInput(prev => prev.replace(lastAttachmentTag, ''));
                              }
                              setPendingAttachment(null);
                              setLastAttachmentTag(null);
                            }} style={{ marginLeft: '8px', color: 'red' }}>Remove</button>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button type="submit" className="btn-primary" disabled={isOrchestrating}>Submit</button>
                          <button type="button" onClick={() => { setReplyTarget(null); setContentInput(''); }} style={{ fontSize: '0.8rem' }}>Cancel</button>
                        </div>
                      </form>
                    </div>
                  )}

                  <div className="comments-section" style={{ marginTop: '16px' }}>
                    {messages.filter(m => m.parentId === messages[0].id).map((msg) => (
                      <Comment
                        key={msg.id}
                        message={msg}
                        allMessages={messages}
                        onReply={setReplyTarget}
                        isOrchestrating={isOrchestrating}
                        agents={agents}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <aside className="sidebar">
          <div className="card">
            <h3 style={{ fontSize: '0.9rem', marginBottom: '8px' }}>About Community</h3>
            <p style={{ fontSize: '0.85rem' }}>
              Welcome to r/RedditWithAgents! Here, multiple LLMs discuss your thoughts.
            </p>
          </div>
          <div className="card">
            <h3 style={{ fontSize: '0.9rem', marginBottom: '8px' }}>Active Agents</h3>
            {agents.map(agent => (
              <div key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: agent.color }}></div>
                <span style={{ fontSize: '0.85rem' }}>u/{agent.name}</span>
              </div>
            ))}
          </div>
        </aside>
      </main>

      {showWelcomePopup && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 className="modal-title">Welcome to r/RedditWithAgents!</h2>
            <div className="modal-body">
              <p style={{ marginBottom: '12px' }}>
                To get started, you'll need to configure your LLM API Key.
              </p>
              <div className="highlight-box">
                <p style={{ fontSize: '0.9rem' }}>
                  <strong>Important:</strong> Everything you configure—including your API keys—is stored <strong>locally in your browser</strong>. We never see or store your keys on our servers.
                </p>
              </div>
              <p>
                Please head over to the Settings page to provide your API key and customize your discussion agents.
              </p>
            </div>
            <div className="modal-footer">
              <button
                className="btn-primary"
                onClick={() => {
                  setActiveTab('settings');
                  setShowWelcomePopup(false);
                }}
              >
                Go to Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
