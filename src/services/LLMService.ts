import type { APIConfig, Message } from '../types';

export class LLMService {
    static async call(config: APIConfig, messages: Message[], systemPrompt: string, modelOverride?: string): Promise<string> {
        if (!config.apiKey || !config.baseUrl) {
            throw new Error('API Key and Base URL are required');
        }

        const formattedMessages = [
            { role: 'system', content: systemPrompt },
            ...messages.map(m => {
                let content = m.content;
                if (m.attachment) {
                    content += `\n\n[ATTACHMENT]:\n${m.attachment}`;
                }
                return { role: m.role, content };
            })
        ];

        try {
            const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model: modelOverride || config.model || 'gpt-3.5-turbo',
                    messages: formattedMessages,
                    temperature: 0.7,
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `API error: ${response.status}`);
            }

            const data = await response.json();
            return data.choices?.[0]?.message?.content || '';
        } catch (error) {
            console.error('LLM API Error:', error);
            throw error;
        }
    }
}
