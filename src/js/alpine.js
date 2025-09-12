import Alpine from "alpinejs";
import intersect from "@alpinejs/intersect";
import { getReferenceResults, getSearchResults } from "./searchContext";
import { chapterIntersected } from "./infinite-scroll";
import chapterAndVerse from "chapter-and-verse";
import slugify from "./slugify";
import baseUrl from "./base-url";


document.addEventListener('alpine:init', () => {
    Alpine.plugin(intersect);

    Alpine.data('searchContext', () => ({
        getReferenceResults,
        getSearchResults,
        /**
         * When the user presses the enter key, validate the user's query with chapter-and-verse
         * and then redirect to the appropriate page.
         * @param {KeyEvent} e 
         */
        GoToReference(query) {
            const result = chapterAndVerse(query);
            if (!result.success) return;

            const book = result.book.name;
            const chapter = result.chapter ?? 1;
            const verse = result.from;

            let url = `${baseUrl()}/${slugify(book, { lower: true })}/${chapter}/`;
            if (verse) url += `#${verse}`;

            this.query = '';

            window.location.href = url;
        },
        /**
         * Add 'book:' filter to the current query
         */
        addBookFilter() {
            if (!this.query.includes('book:')) {
                this.query = `${this.query} book:`.trim();
                this.setLocationQuery(this.query);
                this.getReferenceResults(this.query);
                this.getSearchResults(this.query);
            }
            // Re-focus the search input and position cursor at the end
            const searchInput = document.querySelector('#search');
            if (searchInput) {
                searchInput.focus();
                // Position cursor at the end of the input
                const length = searchInput.value.length;
                searchInput.setSelectionRange(length, length);
            }
        },
        query: new URLSearchParams(window.location.search).get('q') ?? '',
        setLocationQuery(query) {
            const url = new URL(window.location);
            if (query.length) {
                url.searchParams.set('q', query);
            } else {
                url.searchParams.delete('q');
            }
            history.pushState(null, document.title, url.toString())
        },
        setPageQuery(page) {
            const url = new URL(window.location);
            if (!page || page === 1) {
                url.searchParams.delete('p');
            } else {
                url.searchParams.set('p', page);
            }
            history.pushState(null, document.title, url.toString());
        },
        referenceResults: [],
        searchResults: [],
        searchResultsQueryTime: undefined,
        searchPending: false,
        paginationCurrentPage: 1 * (new URLSearchParams(window.location.search).get('p') ?? 1),
        paginationCount: 20,
        paginationTotalPages: 1,
        paginationPageList: [1],
        nextPage() {
            // cap at last page
            if (this.paginationCurrentPage === this.paginationTotalPages) return;
            this.paginationCurrentPage = Math.min(this.paginationTotalPages, this.paginationCurrentPage + 1)
            this.setPageQuery(this.paginationCurrentPage);
            this.getReferenceResults(this.query);
            this.getSearchResults(this.query);
        },
        prevPage() {
            // cap at first page
            if (this.paginationCurrentPage === 1) return;
            this.paginationCurrentPage = Math.max(1, this.paginationCurrentPage - 1)
            this.setPageQuery(this.paginationCurrentPage);
            this.getReferenceResults(this.query);
            this.getSearchResults(this.query);
        },
        setPage(page) {
            // cap within bounds
            if (page === this.paginationCurrentPage) return;
            this.paginationCurrentPage = Math.min(
                this.paginationTotalPages,
                Math.max(1, page)
            )
            this.setPageQuery(this.paginationCurrentPage);
            this.getReferenceResults(this.query);
            this.getSearchResults(this.query);
        }
    }))

    Alpine.data('infiniteScrollContext', () => ({
        chapterIntersected
    }))
})

window.Alpine = Alpine

Alpine.start()