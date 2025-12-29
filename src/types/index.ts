export interface APIConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

export interface Agent {
    id: string;
    name: string;
    role: string;
    color: string;
    model?: string;
    systemPrompt?: string;
    personalityType: string;
}

export interface Message {
    id: string;
    author: string;
    role: 'user' | 'assistant';
    content: string;
    parentId?: string | null;
    isTyping?: boolean;
    attachment?: string;
}

export interface Post {
    id: string;
    content: string;
    author: string;
    createdAt: number;
    attachment?: string;
}
