const fs = require('fs');
const path = require('path');
const slugify = require('slugify');
const verses = require('kjv/json/verses-1769.json')
const chapterAndVerse = require('chapter-and-verse');

const VERSION = "KJV";

/**
 * Replaces substrings liks `[word]` with `<em>word</em>`
 */
const parseItalics = (text) => text.replace(/\[(.+?)\]/g, '<em>$1</em>')
const parseParagraphs = (text) => text.replace(/# ?/g, '')
const smallcapsLord = (text) => text.replace(/LORD'S/g, '<span style="font-variant-caps: small-caps">Lord\'s</span>').replace(/LORD/g, '<span style="font-variant-caps: small-caps">Lord</span>')
const theirs = (text) => text.replace(/their's/g, 'theirs')
const trim = (text) => text.trim()

const wrapVerse = (text, verse) => ({ verse, text })

function cleanText(text) {
    const mappers = [
        parseParagraphs,
        parseItalics,
        smallcapsLord,
        theirs,
        trim
    ]
    return mappers.reduce((text, fn) => fn(text), text)
}

async function main() {
    // Generate JSON object
    const books = {}
    for (const reference in verses) {
        const parsedReference = chapterAndVerse(reference.replace(/Solomon's Song/g, 'Song of Solomon'));
        const book = parsedReference.book.name;
        books[book] ??= {
            title: book,
            slug: `/${slugify(book, { lower: true })}/`,
            testament: parsedReference.book.testament,
            chapters: {},
        }
        books[book].chapters[parsedReference.chapter] ??= {};
        books[book].chapters[parsedReference.chapter][parsedReference.from] = wrapVerse(cleanText(verses[reference]), parsedReference.from);
    }

    const chapterList = Object.entries(books).map(([book, { chapters }]) => Object.keys(chapters).map(chapter => `/${slugify(book, { lower: true })}/${chapter}/`)).flat();
    const nextChapter = (slug) => {
        const index = chapterList.indexOf(slug);
        if (index === -1) return undefined;
        return chapterList[index + 1];
    }
    const prevChapter = (slug) => {
        const index = chapterList.indexOf(slug);
        if (index === -1) return undefined;
        return chapterList[index - 1];
    }

    const chapters = Object.entries(books).map(([book, { chapters, slug: bookSlug }]) => Object.entries(chapters).map(([chapter, verses]) => ({
        book,
        chapter,
        slug: `${bookSlug}${chapter}/`,
        verses: Object.values(verses),
        nextChapter: nextChapter(`${bookSlug}${chapter}/`),
        prevChapter: prevChapter(`${bookSlug}${chapter}/`),
    }))).flat();

    const output = JSON.stringify({
        books,
        chapters
    })

    // write output to src/_data/bible.json
    const outputFile = path.join(__dirname, '../src/_data/bible.json')
    fs.writeFileSync(outputFile, output);
    console.log("Output rendered")

    // generate indexes 
    generateIndexes();
}

/**
 * Generates indexes
 */
function generateIndexes() {
    const verseMap = Object.entries(verses).reduce((acc, [title, content]) => {
        const parsedReference = chapterAndVerse(title.replace(/Solomon's Song/g, 'Song of Solomon'));
        const book = parsedReference.book.name;
        const chapter = parsedReference.chapter;
        const verse = parsedReference.from;
        const verseKey = `${book} ${chapter}:${verse}`;
        
        // Enhanced structure with book information for easier filtering
        acc[verseKey] = {
            content: cleanText(content),
            book: slugify(book, { lower: true }),
            chapter: chapter,
            verse: verse,
            title: verseKey
        };
        return acc;
    }, {});

    const outputOriginalFile = path.join(__dirname, '../src/js/verses.json')
    fs.writeFileSync(outputOriginalFile, JSON.stringify(verseMap));
}

main().catch(console.error);