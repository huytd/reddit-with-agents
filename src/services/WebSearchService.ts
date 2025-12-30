export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

export class WebSearchService {
    private static readonly BASE_URL = 'https://quicksearch-qkz6.onrender.com';

    /**
     * Perform a web search and return up to 10 results
     */
    static async search(query: string): Promise<SearchResult[]> {
        try {
            const response = await fetch(`${this.BASE_URL}/search?q=${encodeURIComponent(query)}`);

            if (!response.ok) {
                throw new Error(`Search API error: ${response.status}`);
            }

            const data = await response.json();
            return data.results || [];
        } catch (error) {
            console.error('Web search error:', error);
            throw error;
        }
    }

    /**
     * Read the content of a URL and return it as text
     */
    static async readUrl(url: string): Promise<string> {
        try {
            const response = await fetch(`${this.BASE_URL}/read?url=${encodeURIComponent(url)}`);

            if (!response.ok) {
                throw new Error(`Read API error: ${response.status}`);
            }

            const data = await response.json();
            return data.content || data.text || '';
        } catch (error) {
            console.error('URL read error:', error);
            throw error;
        }
    }

    /**
     * Search for information and read relevant URLs, returning comprehensive results
     */
    static async searchAndRead(query: string, maxUrlsToRead: number = 3): Promise<{
        searchResults: SearchResult[];
        content: string;
    }> {
        try {
            const searchResults = await this.search(query);

            if (searchResults.length === 0) {
                return {
                    searchResults: [],
                    content: 'No search results found.'
                };
            }

            // Read content from top URLs (limited to avoid too many requests)
            const urlsToRead = searchResults.slice(0, maxUrlsToRead);
            const contentPromises = urlsToRead.map((result, index) =>
                this.readUrl(result.url).catch(err => {
                    console.error(`Failed to read ${result.url}:`, err);
                    return `[Failed to read ${result.url}]`;
                })
            );

            const contents = await Promise.all(contentPromises);

            // Format the content with source attribution
            let formattedContent = `Search Results for "${query}":\n\n`;

            searchResults.forEach((result, index) => {
                formattedContent += `Source ${index + 1}: ${result.title}\n`;
                formattedContent += `URL: ${result.url}\n`;
                formattedContent += `Snippet: ${result.snippet}\n`;

                if (index < contents.length) {
                    formattedContent += `Content: ${contents[index]}\n`;
                }
                formattedContent += '\n' + '='.repeat(80) + '\n\n';
            });

            return {
                searchResults,
                content: formattedContent
            };
        } catch (error) {
            console.error('Search and read error:', error);
            throw error;
        }
    }
}