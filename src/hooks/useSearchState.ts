import { useState, useEffect } from "react";

interface Book {
    id: number;
    title: string;
    author: string;
    publisher?: string;
    year?: number;
    language?: string;
    extension?: string;
    filesize?: number;
    filesizeString?: string;
    hash?: string;
    cover?: string;
    description?: string;
    pages?: number;
    [key: string]: any;
}

interface Pagination {
    limit?: number;
    current?: number;
    total_items?: number;
    total_pages?: number;
}

interface SearchState {
    query: string;
    books: Book[];
    pagination: Pagination;
    currentPage: number;
    searched: boolean;
    // Filter parameters (persisted)
    selectedLang: string;
    selectedOrder: string;
    selectedExt: string;
    exactMatch: boolean;
}

const STORAGE_KEY = "olib_search_state";

const defaultState: SearchState = {
    query: "",
    books: [],
    pagination: {},
    currentPage: 1,
    searched: false,
    selectedLang: "所有语言",
    selectedOrder: "匹配度",
    selectedExt: "所有格式",
    exactMatch: false,
};

export function useSearchState() {
    const [state, setState] = useState<SearchState>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                // Merge with defaults to handle newly added fields
                return { ...defaultState, ...JSON.parse(saved) };
            }
        } catch (err) {
            console.error("Failed to load search state:", err);
        }
        return defaultState;
    });

    // Save to localStorage whenever state changes
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (err) {
            console.error("Failed to save search state:", err);
        }
    }, [state]);

    const updateState = (updates: Partial<SearchState>) => {
        setState((prev) => ({ ...prev, ...updates }));
    };

    const clearState = () => {
        setState(defaultState);
        localStorage.removeItem(STORAGE_KEY);
    };

    return {
        state,
        updateState,
        clearState,
    };
}
