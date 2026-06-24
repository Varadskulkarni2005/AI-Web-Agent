export const browserTools = [
    {
        type: "function",
        function: {
            name: "browser_snapshot",
            description: "Takes a fresh accessibility snapshot of the current web page. Use this to see what is currently on the screen. Returns a compact hierarchy of visible elements with stable ref IDs.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browser_click",
            description: "Clicks on an element using its unique reference ID (e.g., 'e15') obtained from the browser_snapshot.",
            parameters: {
                type: "object",
                properties: {
                    ref: { type: "string", description: "The reference ID of the element to click, e.g. 'e12'." }
                },
                required: ["ref"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browser_type",
            description: "Types text into an input field using its reference ID.",
            parameters: {
                type: "object",
                properties: {
                    ref: { type: "string", description: "The reference ID of the element." },
                    text: { type: "string", description: "The text to type." }
                },
                required: ["ref", "text"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browser_navigate",
            description: "Navigates the browser to a specific URL.",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "The full URL to navigate to (e.g., 'https://www.google.com')." }
                },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browser_open_tab",
            description: "Opens a new browser tab, optionally navigating it to a URL.",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "Optional URL to open in the new tab." }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browser_scroll",
            description: "Scrolls the page up or down.",
            parameters: {
                type: "object",
                properties: {
                    direction: { type: "string", enum: ["up", "down"], description: "The direction to scroll." }
                },
                required: ["direction"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browser_press_key",
            description: "Presses a specific keyboard key (e.g., 'Enter', 'Escape').",
            parameters: {
                type: "object",
                properties: {
                    key: { type: "string", description: "The key name to press (e.g., 'Enter')." }
                },
                required: ["key"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browser_wait",
            description: "Waits for the page to settle after a navigation, animation, or SPA update.",
            parameters: {
                type: "object",
                properties: {
                    ms: { type: "number", description: "How long to wait in milliseconds." }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browser_back",
            description: "Navigates back in browser history.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browser_extract_text",
            description: "Extracts the visible text from the current page or a selected region for inspection.",
            parameters: {
                type: "object",
                properties: {
                    scope: { type: "string", description: "Optional selector or area hint such as 'page' or 'body'." }
                },
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browser_find_text",
            description: "Searches the current snapshot for matching text or labels and returns candidate refs.",
            parameters: {
                type: "object",
                properties: {
                    text: { type: "string", description: "Text to search for." }
                },
                required: ["text"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "browser_close_modal",
            description: "Attempts to close cookie banners, dialogs, or overlays by pressing Escape or clicking common dismiss buttons.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "task_complete",
            description: "Call this tool when the overall goal has been successfully achieved or if it is impossible to proceed. Provide a summary of the outcome or the answer to the user's question.",
            parameters: {
                type: "object",
                properties: {
                    summary: { type: "string", description: "Summary of what was accomplished, or the answer to the user's question." }
                },
                required: ["summary"]
            }
        }
    }
];
