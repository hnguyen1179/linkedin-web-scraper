require("dotenv").config({ path: __dirname + "/.env" });
const fs = require("fs");
const puppeteer = require("puppeteer");

const pastWeek =
    "https://www.linkedin.com/jobs/search?keywords=%22Front%20End%22%20Developer%20OR%20%22Frontend%22%20Developer%20OR%20%22Front%20End%22%20Engineer%20OR%20%22Frontend%22%20Engineer&location=San%20Francisco%20Bay%20Area&locationId=&geoId=90000084&sortBy=R&f_TPR=r604800&f_E=1%2C2&position=1&pageNum=0";

const pastMonth =
    "https://www.linkedin.com/jobs/search/?f_E=1%2C2&f_TPR=r2592000&geoId=90000084&keywords=%22front%20end%22%20developer%20OR%20%22frontend%22%20developer%20OR%20%22front%20end%22%20engineer%20OR%20%22frontend%22%20engineer&location=San%20Francisco%20Bay%20Area&locationId=&sortBy=R";

// Sign In ... Iterate through the pages; and on each page iteration, iterate through the list and scan the listings
// Code for iterate through the pages...
// document.querySelector(".artdeco-pagination__pages").childElementCount;
// document.querySelector("button[aria-label="Page 1"]")

// TO DO:
/**
 * 1. Rewrite this project into TypeScript?
 * 2. Make it jump through the pages?
 * 3. Add more filters?
 */

// Will filter the UL list to only include postings that meet your requirement
function grabPostingLinks() {
    return [
        ...document.querySelector(".jobs-search-results__list").children,
    ].map((li) => li.getAttribute("data-occludable-entity-urn"));
}

async function signIn(page) {
    const [signInLink] = await page.$x("/html/body/div[1]/header/nav/div/a[2]");
    await Promise.all([signInLink.click(), page.waitForNavigation()]);

    await page.type("#username", process.env.LI_USER, { delay: 60 });
    await page.type("#password", process.env.LI_PASS, { delay: 60 });

    const [signInButton] = await page.$x(
        "//*[@id='organic-div']/form/div[3]/button"
    );
    await Promise.all([signInButton.click(), page.waitForNavigation()]);
}

async function textExtractor() {
    function dateConverter(string) {
        if (/hour/.test(string)) {
            return new Date().toLocaleDateString();
        } else if (/week/.test(string)) {
            const [weeksAgo] = string.match(/\d+/);
            const dt = new Date();
            dt.setDate(dt.getDate() - parseInt(weeksAgo) * 7);
            return dt.toLocaleDateString();
        } else if (/day/.test(string)) {
            const [daysAgo] = string.match(/\d+/);
            const dt = new Date();
            dt.setDate(dt.getDate() - parseInt(daysAgo));
            return dt.toLocaleDateString();
        }
    }

    let company = document.querySelector(
        ".jobs-unified-top-card__subtitle-primary-grouping.mr2.t-black > span > a"
    );
    if (company) company = company.innerText.trim();

    let location = document.querySelector(".jobs-unified-top-card__bullet");
    if (location) location = location.innerText.trim();

    const sincePosted = document
        .querySelector(".jobs-unified-top-card__posted-date")
        .innerText.trim();

    const datePosted = dateConverter(sincePosted);

    const title = document
        .querySelector('h2[class="t-24 t-bold"]')
        .innerText.trim();

    const url =
        "https://www.linkedin.com" +
        document
            .querySelector(".jobs-unified-top-card__content--two-pane > a")
            .getAttribute("href");

    const description = document
        .querySelector('article[class="jobs-description__container m4"]')
        .innerText.replace("\n", " ");

    return [company, location, datePosted, title, url, description];
}

function titleFilter(title) {
    const test1 = /front|ui|web/i.test(title);
    const test2 =
        !/senior|sr|lead|mid|angular|vue|ii|iii|years|java[^s]|full/i.test(
            title
        );

    return ![test1, test2].every((test) => test === true);
}

// Things to exclude:
// #+ years
// # years
// #(non-zero) to # years
// #(non-zero)-# years
function experienceFilter(description) {
    const pattern = new RegExp(
        /\d+\+ years|\d+ years|[1-9] to [1-9] years|[1-9]-[1-9] years|[1-9]-[1-9] \+ years|[1-9] \+ years|years of experience|yrs of experience/i
    );

    // Should go through the text, and if the description contains any of the
    // above; it should return FALSE
    // If the job passes, it should return TRUE
    return !pattern.test(description);
}

async function scrapePostings(page, textExtractor) {
    const validPostings = [];

    // ----------------- repaste into original code after done
    const postingsLinks = await page.evaluate(grabPostingLinks);
    console.log(postingsLinks);

    // 1a. Scrolling to the bottom in order to preload all the titles
    await page.evaluate(() => {
        const scrollable = document.querySelector(
            ".jobs-search-results.display-flex.flex-column"
        );

        const heightToScroll = document.querySelector(
            ".jobs-search-results__list.list-style-none"
        ).offsetHeight;

        scrollable.scrollTo({
            left: 0,
            top: heightToScroll,
            behavior: "smooth",
        });
    });

    await page.waitForTimeout(Math.random() * 500 + 1000);

    // 2. Iterate through the postings and extract information from each
    for (let id of postingsLinks) {
        // 2aa. Check to see if the posting title includes 'front', etc. If no, skip
        const jobTitle = await page.evaluate((id) => {
            return document.querySelector(
                `li[data-occludable-entity-urn='${id}'] .job-card-list__title`
            ).innerText;
        }, id);

        if (titleFilter(jobTitle)) {
            continue;
        }

        const postingClickDelay = Math.floor(Math.random() * 500) + 300;

        // 2a. Click on each individual li element within the ul job postings
        await Promise.all([
            page.click(`li[data-occludable-entity-urn='${id}']`),
            page.waitForNavigation(),
        ]);

        // 2b. Extract the information from each link; this can be separate function to grab the title, body, etc within a single function
        const [company, title, location, datePosted, url, description] =
            await page.evaluate(textExtractor);

        // 2c. Run a regex on the extracted text to decide whether you should filter it into the final validPostings
        if (experienceFilter(description)) {
            validPostings.push({
                company,
                title,
                location,
                datePosted,
                title,
                url,
            });
        }

        // 2d. Run a wait timer in order to prevent a 429 error
        await page.waitForTimeout(postingClickDelay);
    }
    // -----------------

    // try {
    //     let nextPage = 1;
    //     let checkCondition = await page.evaluate((nextPage) => {
    //         return document.querySelector(
    //             `button[aria-label="Page ${nextPage}"]`
    //         );
    //     }, nextPage);

    //     // Each loop will click through a new page
    //     while (checkCondition) {
    //         // Now you want to filter the list of ul job postings via grabPostingLinks
    //         // 1. Grab all of the li > div > a's href attributes into an array
    //         const postingsLinks = await page.evaluate(grabPostingLinks);
    //         console.log(postingsLinks);

    //         // 1a. Scrolling to the bottom in order to preload all the titles
    //         await page.evaluate(() => {
    //             const scrollable = document.querySelector(
    //                 ".jobs-search-results.display-flex.flex-column"
    //             );

    //             const heightToScroll = document.querySelector(
    //                 ".jobs-search-results__list.list-style-none"
    //             ).offsetHeight;

    //             scrollable.scrollTo({
    //                 left: 0,
    //                 top: heightToScroll,
    //                 behavior: "smooth",
    //             });
    //         });

    //         await page.waitForTimeout(Math.random() * 500 + 1000);

    //         // 2. Iterate through the postings and extract information from each
    //         for (let id of postingsLinks) {
    //             // 2aa. Check to see if the posting title includes 'front', etc. If no, skip
    //             const jobTitle = await page.evaluate((id) => {
    //                 return document.querySelector(
    //                     `li[data-occludable-entity-urn='${id}'] .job-card-list__title`
    //                 ).innerText;
    //             }, id);

    //             if (titleFilter(jobTitle)) {
    //                 continue;
    //             }

    //             const postingClickDelay = Math.floor(Math.random() * 500) + 300;

    //             // 2a. Click on each individual li element within the ul job postings
    //             await Promise.all([
    //                 page.click(`li[data-occludable-entity-urn='${id}']`),
    //                 page.waitForNavigation(),
    //             ]);

    //             // 2b. Extract the information from each link; this can be separate function to grab the title, body, etc within a single function
    //             const [company, title, location, datePosted, url, description] =
    //                 await page.evaluate(textExtractor);

    //             // 2c. Run a regex on the extracted text to decide whether you should filter it into the final validPostings
    //             if (experienceFilter(description)) {
    //                 validPostings.push({
    //                     company,
    //                     title,
    //                     location,
    //                     datePosted,
    //                     title,
    //                     url,
    //                 });
    //             }

    //             // 2d. Run a wait timer in order to prevent a 429 error
    //             await page.waitForTimeout(postingClickDelay);
    //         }

    //         // 3. Reset the checkCondition
    //         nextPage++;
    //         checkCondition = await page.evaluate((nextPage) => {
    //             return document.querySelector(
    //                 `button[aria-label="Page ${nextPage}"]`
    //             );
    //         }, nextPage);

    //         // 4. Jump to the next page
    //         if (checkCondition) {
    //             const nextPageClickDelay =
    //                 Math.floor(Math.random() * 1000) + 500;

    //             await Promise.all([
    //                 page.click(`button[aria-label="Page ${nextPage}"]`),
    //                 page.waitForNavigation(),
    //                 page.waitForTimeout(nextPageClickDelay),
    //             ]);
    //         }
    //     }
    // } catch (e) {
    //     // Do something with error
    //     console.log(e);
    // }

    return validPostings;
}

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
    });

    const page = await browser.newPage();

    await Promise.all([
        page.setViewport({ width: 1440, height: 1000 }),
        page.goto(pastMonth),
    ]);

    // Signing in
    await signIn(page);

    // Scrape
    const validPostings = await scrapePostings(page, textExtractor);
    console.log("validPostings: ", validPostings);

    const formattedPostings = validPostings.map((post) => {
        const { company, title, location, datePosted, url } = post;
        return `${company}\t${title}\t${location}\t${datePosted}\t${url}`;
    });
    console.log("formattedPostings: ", formattedPostings);

    // Print Results
    fs.writeFile("./output.txt", formattedPostings.join("\n"), (e) => {
        if (e) return console.log(e);
        console.log("File successfully written");
    });
    // browser.close();
})();
