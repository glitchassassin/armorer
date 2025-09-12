import slugify from "./slugify";
import * as JsSearch from 'js-search';
import { stemmer } from 'porter-stemmer';
import chapterAndVerse from 'chapter-and-verse';

const searchIndex = fetch(`./verses.json`)
    .then(r => r.json())
    .then(verses => {
        const search = new JsSearch.Search('title');
        search.tokenizer =  new JsSearch.StemmingTokenizer(stemmer, 
                            new JsSearch.StopWordsTokenizer(
                            new JsSearch.SimpleTokenizer()));
        search.searchIndex = new JsSearch.UnorderedSearchIndex();
        search.addIndex('content');
        search.addIndex('book');
        search.addDocuments(Object.values(verses));
        return search;
    });

/**
 * Parse query for book filter (e.g., "peace book:proverbs")
 * @param {string} query - The search query
 * @returns {Object} - { searchQuery: string, bookFilter: string|null }
 */
function parseQuery(query) {
    const bookRegex = /book:([A-Za-z0-9\-]+)/i;
    const bookMatch = query.match(bookRegex);
    if (bookMatch) {
        const bookFilter = bookMatch[1].toLowerCase();
        const searchQuery = query.replace(bookRegex, '').trim();
        return { searchQuery, bookFilter };
    }
    return { searchQuery: query, bookFilter: null };
}

/**
 * Given a query and some pagination parameters, search with Fuse
 * and return the matching results. `key` is passed through to match
 * the request with the response.
 */
onmessage = async function ({data: { query, start, count, key } }) {
    const { searchQuery, bookFilter } = parseQuery(query);
    let results = (await searchIndex).search(searchQuery);
    
    // Apply book filter if specified
    if (bookFilter) {
        results = results.filter(r => 
            r.book && r.book.includes(bookFilter)
        );
    }

    postMessage({
        key,
        results: results.map(r => {
            const reference = chapterAndVerse(r.title)
            const book = reference.book.name;
            const chapter = reference.chapter;
            const verse = reference.from;
    
            return {
                title: r.title,
                content: r.content,
                url: `/${slugify(book, {lower: true})}/${chapter}/#${verse}`,
            }
        }).slice(start, start + count),
        resultCount: results.length
    })
}