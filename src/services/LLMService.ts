import type { APIConfig, Message } from '../types';
import { WebSearchService } from './WebSearchService';

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
            const content = data.choices?.[0]?.message?.content || '';

            // Check if the response contains web search commands
            const searchResults = this.extractSearchCommands(content);

            if (searchResults.length > 0) {
                // Execute searches and retry with results
                return await this.executeSearchAndRetry(
                    config,
                    messages,
                    systemPrompt,
                    modelOverride,
                    content,
                    searchResults
                );
            }

            return content;
        } catch (error) {
            console.error('LLM API Error:', error);
            throw error;
        }
    }

    private static extractSearchCommands(content: string): Array<{
        type: 'SEARCH' | 'READ' | 'SEARCH_AND_READ';
        query: string;
    }> {
        const commands: Array<{ type: 'SEARCH' | 'READ' | 'SEARCH_AND_READ'; query: string }> = [];
        const searchRegex = /\[SEARCH:\s*([^\]]+)\]/gi;
        const readRegex = /\[READ:\s*([^\]]+)\]/gi;
        const searchAndReadRegex = /\[SEARCH_AND_READ:\s*([^\]]+)\]/gi;

        let match;
        while ((match = searchRegex.exec(content)) !== null) {
            commands.push({ type: 'SEARCH', query: match[1].trim() });
        }

        while ((match = readRegex.exec(content)) !== null) {
            commands.push({ type: 'READ', query: match[1].trim() });
        }

        while ((match = searchAndReadRegex.exec(content)) !== null) {
            commands.push({ type: 'SEARCH_AND_READ', query: match[1].trim() });
        }

        return commands;
    }

    private static async executeSearchAndRetry(
        config: APIConfig,
        messages: Message[],
        systemPrompt: string,
        modelOverride: string | undefined,
        originalContent: string,
        commands: Array<{ type: 'SEARCH' | 'READ' | 'SEARCH_AND_READ'; query: string }>
    ): Promise<string> {
        // Remove search commands from the original content
        let cleanedContent = originalContent;
        cleanedContent = cleanedContent.replace(/\[SEARCH:[^\]]+\]/gi, '');
        cleanedContent = cleanedContent.replace(/\[READ:[^\]]+\]/gi, '');
        cleanedContent = cleanedContent.replace(/\[SEARCH_AND_READ:[^\]]+\]/gi, '');
        cleanedContent = cleanedContent.replace(/^\s*\[.*?\]\s*$/gm, '');

        // Execute all search commands
        let searchResults = '\n\n=== WEB SEARCH RESULTS ===\n\n';

        for (const cmd of commands) {
            try {
                if (cmd.type === 'SEARCH') {
                    const results = await WebSearchService.search(cmd.query);
                    searchResults += `Search query: "${cmd.query}"\n\n`;
                    results.forEach((result, index) => {
                        searchResults += `[${index + 1}] ${result.title}\n`;
                        searchResults += `URL: ${result.url}\n`;
                        searchResults += `Snippet: ${result.snippet}\n\n`;
                    });
                } else if (cmd.type === 'READ') {
                    const content = await WebSearchService.readUrl(cmd.query);
                    searchResults += `Reading URL: "${cmd.query}"\n\n`;
                    searchResults += content;
                    searchResults += '\n\n';
                } else if (cmd.type === 'SEARCH_AND_READ') {
                    const { content, searchResults: results } = await WebSearchService.searchAndRead(cmd.query);
                    searchResults += `Search and read query: "${cmd.query}"\n\n`;
                    searchResults += content;
                }
                searchResults += '\n' + '='.repeat(80) + '\n\n';
            } catch (error) {
                console.error(`Error executing ${cmd.type} for "${cmd.query}":`, error);
                searchResults += `Error executing ${cmd.type} for "${cmd.query}": ${error}\n\n`;
                searchResults += '='.repeat(80) + '\n\n';
            }
        }

        // Create a new message with the search results
        const searchMessage: Message = {
            id: `search_${Date.now()}`,
            author: 'System',
            role: 'user',
            content: `I performed web searches based on your request. Here are the results:\n${searchResults}\n\nPlease incorporate this information into your response. Remove any search command markers like [SEARCH: ...] from your response.`
        };

        // Retry the API call with search results included
        const newMessages = [...messages, searchMessage];

        const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: modelOverride || config.model || 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...newMessages.map(m => {
                        let content = m.content;
                        if (m.attachment) {
                            content += `\n\n[ATTACHMENT]:\n${m.attachment}`;
                        }
                        return { role: m.role, content };
                    })
                ],
                temperature: 0.7,
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || cleanedContent || 'No response generated.';
    }
}
