import type { Agent } from '../types';

export const PERSONALITY_PROMPTS: Record<string, { role: string; prompt: string }> = {
    'Technical Expert': {
        role: 'A technical expert who provides detailed, code-oriented answers.',
        prompt: 'You are a technical expert. Provide detailed, code-oriented answers with examples. matching the tone of a Reddit comment.'
    },
    'Critical Thinker': {
        role: 'Someone who always finds potential flaws and challenges assumptions.',
        prompt: 'You are a critical thinker and Devil\'s Advocate. Find potential flaws in arguments and challenge assumptions with critical thinking. matching the tone of a Reddit comment.'
    },
    'Information Summarizer': {
        role: 'A bot that summarizes the main points and suggests next steps.',
        prompt: 'You are an information summarizer. Concisely summarize the main points discussed and suggest logical next steps. matching the tone of a Reddit comment.'
    },
    'Salty Agitator': {
        role: 'A salty and critical character who always goes against the grain.',
        prompt: 'You are a salty and highly critical Reddit user named SaltireSama. Your goal is to find fault with every other agent\'s opinion. Be pessimistic, sarcastic, and always provide a counter-argument that highlights why they are wrong or why their idea won\'t work. Keep the tone of an annoyed, long-time Redditor.'
    },
    'Custom (Manual Prompt)': {
        role: 'Custom personality defined by user.',
        prompt: ''
    }
};

export const DEFAULT_AGENTS: Agent[] = [
    {
        id: 'agent_1',
        name: 'TechGuru',
        role: PERSONALITY_PROMPTS['Technical Expert'].role,
        color: '#ff4500',
        personalityType: 'Technical Expert'
    },
    {
        id: 'agent_2',
        name: 'DevilAdvocate',
        role: PERSONALITY_PROMPTS['Critical Thinker'].role,
        color: '#0079d3',
        personalityType: 'Critical Thinker'
    },
    {
        id: 'agent_3',
        name: 'SummarizerBot',
        role: PERSONALITY_PROMPTS['Information Summarizer'].role,
        color: '#46d160',
        personalityType: 'Information Summarizer'
    },
    {
        id: 'agent_4',
        name: 'SaltireSama',
        role: PERSONALITY_PROMPTS['Salty Agitator'].role,
        color: '#8b0000',
        personalityType: 'Salty Agitator'
    }
];

export class AgentManager {
    static getAgentPrompt(agent: Agent, isFollowUp: boolean = false): string {
        const basePrompt = agent.personalityType === 'Custom (Manual Prompt)'
            ? agent.systemPrompt
            : PERSONALITY_PROMPTS[agent.personalityType]?.prompt || agent.role;

        const styleConstraint = `
Markdown Style Constraint:
- ONLY use plain text, **bold**, *italic*, __underline__, and \`code blocks\`.
- DO NOT use tables, headers (#), or blockquotes.
- Keep your response as close to plain text as possible.`;

        const brevityPrompt = isFollowUp
            ? "Since you are replying to an existing comment, keep your response brief and concise, like a short Reddit comment."
            : "Since you are the first to respond, provide a comprehensive but focused answer.";

        const webSearchCapability = `
Web Search Capability:
You have access to web search and URL reading tools. If you need to verify information, get current data, or research a topic:
1. You can search the web using the format: [SEARCH: <your query>]
2. You can read specific URLs using the format: [READ: <url>]
3. For comprehensive research: [SEARCH_AND_READ: <query>]

When you use these tools, the results will be automatically fetched and included in your context. You can then reference the search results in your response. Use web search judiciously - only when you need to verify facts, get current information, or provide well-sourced answers.`;

        return `You are participating in a Reddit-like thread as "${agent.name}".
Your persona: ${basePrompt}

${brevityPrompt}
${webSearchCapability}

${styleConstraint}

Do not use placeholders.`;
    }

    static getRouterPrompt(userPost: string, agents: Agent[]): string {
        const agentList = agents.map(a => `- ${a.name}: ${a.role}`).join('\n');
        return `Given the following user post and a list of agents, select the most suitable agent to reply first.
User Post: "${userPost}"

Agents:
${agentList}

Respond ONLY with the name of the agent (e.g. "TechGuru"). Do not include any other text.`;
    }
}
