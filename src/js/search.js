import chapterAndVerse from "chapter-and-verse";
import slugify from "slugify";

/**
 * When the user presses the enter key, validate the user's query with chapter-and-verse
 * and then redirect to the appropriate page.
 * @param {KeyEvent} e 
 */
function search(e) {
    if (e.key !== "Enter") return;
    console.log(e);
    const query = e.target.value;

    const result = chapterAndVerse(query);
    if (!result.success) return;

    const book = result.book.name;
    const chapter = result.chapter;
    const verse = result.from;

    const urlBase = document.querySelector('#home').href;

    let url = `${urlBase}${slugify(book, {lower: true})}/${chapter}/`;
    if (verse) url += `#${verse}`;

    window.location.href = url;
}

document.querySelector('#SearchForReference').addEventListener('keydown', search);