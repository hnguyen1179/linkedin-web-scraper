require("dotenv").config({ path: __dirname + "/.env" });
const fs = require("fs");
const puppeteer = require("puppeteer");

const PAST_WEEK_URL =
  "https://www.linkedin.com/jobs/search?keywords=%22Front%20End%22%20Developer%20OR%20%22Frontend%22%20Developer%20OR%20%22Front%20End%22%20Engineer%20OR%20%22Frontend%22%20Engineer&location=San%20Francisco%20Bay%20Area&locationId=&geoId=90000084&sortBy=R&f_TPR=r604800&f_E=1%2C2&position=1&pageNum=0";

const PAST_WEEK_EXPANDED_URL =
  "https://www.linkedin.com/jobs/search/?f_E=1%2C2%2C3%2C4&f_TPR=r604800&geoId=90000084&keywords=%22front%20end%22%20developer%20OR%20%22frontend%22%20developer%20OR%20%22front%20end%22%20engineer%20OR%20%22frontend%22%20engineer&location=San%20Francisco%20Bay%20Area&locationId=&sortBy=R";

const PAST_WEEK_NYC_URL =
  "https://www.linkedin.com/jobs/search/?f_E=1%2C2%2C3%2C4&f_TPR=r604800&geoId=90000070&keywords=%22front%20end%22%20developer%20OR%20%22frontend%22%20developer%20OR%20%22front%20end%22%20engineer%20OR%20%22frontend%22%20engineer&location=New%20York%20City%20Metropolitan%20Area&locationId=&sortBy=R";
const PAST_MONTH_URL =
  "https://www.linkedin.com/jobs/search/?f_E=1%2C2&f_TPR=r2592000&geoId=90000084&keywords=%22front%20end%22%20developer%20OR%20%22frontend%22%20developer%20OR%20%22front%20end%22%20engineer%20OR%20%22frontend%22%20engineer&location=San%20Francisco%20Bay%20Area&locationId=&sortBy=R";

// TO DO:
/**
 * 1. MAKE LOOKING THROUGH CONNECTIONS WORK; ITS NOT HITTING A CERTAIN PART ON LINE 214
 */

// This function grabs the id of each job posting
function grabPostingIDs() {
  return [
    ...document.querySelector(".scaffold-layout__list-container").children,
  ].map((li) => li.getAttribute("data-occludable-job-id"));
}

// Signs into LinkedIn
async function signIn(page) {
  const [signInLink] = await page.$x("/html/body/div[1]/header/nav/div/a[2]");
  await Promise.all([signInLink.click(), page.waitForNavigation()]);

  await page.type("#username", process.env.LI_USER, { delay: 60 });
  await page.type("#password", process.env.LI_PASS, { delay: 60 });

  const [signInButton] = await page.$x(
    "//*[@id='organic-div']/form/div[3]/button"
  );
  await Promise.all([signInButton.click(), page.waitForNavigation()]);

  // Clicking on "Not Now"
  // const [notNowLink] = await page.$x(
  //     "//*[@id='remember-me-prompt__form-secondary']/button"
  // );
  // await Promise.all([notNowLink.click(), page.waitForNavigation()]);
}

// Extracts all the relevant information from a job posting
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
    .querySelector(".jobs-box__html-content.jobs-description-content__text")
    .innerText.replace("\n", " ");

  return [company, location, datePosted, title, url, description];
}

function titleFilter(title) {
  const test1 = /front|ui|web developer/i.test(title);
  const test2 =
    !/senior|staff|sr|lead|mid|angular|vue|ii|iii|years|java[^s]|full/i.test(
      title
    );

  return ![test1, test2].every((test) => test === true);
}

// Filters job postings to exclude invalid job postings. Checks for years of experience required
function experienceFilter(description) {
  const pattern = new RegExp(
    /\d+\+ years|\d+ years|[1-9] to [1-9] years|[1-9]-[1-9] years|[1-9]-[1-9] \+ years|[1-9] \+ years|years of experience|yrs of experience/i
  );
  const yearsPattern = new RegExp(
    /(\d+)\+ years|(\d+) years|([1-9]) to [1-9] years|([1-9])-[1-9] years|([1-9])-[1-9] \+ years|([1-9]) \+ years|(\d+).+years/i
  );

  const metMinimum = !pattern.test(description);
  let minimumYears = 0;

  if (!metMinimum && description.match(yearsPattern) !== null) {
    const [yearsMin] = [...description.match(yearsPattern)].filter(
      (match) => match && match.length == 1
    );

    minimumYears = parseInt(yearsMin);
  }

  return [metMinimum, minimumYears];
}

function scrollToBottom() {
  const scrollable = document.querySelector(".scaffold-layout__list-container");

  const heightToScroll = document.querySelector(
    ".scaffold-layout__list-container"
  ).offsetHeight;

  scrollable.scrollTo({
    left: 0,
    top: heightToScroll,
    behavior: "smooth",
  });
}

// Main function that will iterate through pages and scrapes postings per page
async function scrapePostings(browser, page, textExtractor) {
  console.log("Entering scrape function");
  const validPostings = [];
  const postingDescriptions = [];

  try {
    console.log("Entering try clause");
    let nextPage = 1;

    // checkCondition is a button element for the next page. Loop will run if there is a next page! 
    let checkCondition = await page.evaluate((nextPage) => {
      let condition = document.querySelector(
        `button[aria-label="Page ${nextPage}"]`
      );
      return condition;
    }, nextPage);

    // Each loop will click through a new page
    while (!!checkCondition) {
      console.log("In while loop");
      // Now you want to filter the list of ul job postings via grabPostingLinks
      // 1. Grab all of the li > div > a's href attributes into an array
      // ---------------------------------------------------------------------------
      const postingsLinks = await page.evaluate(grabPostingIDs);

      // 1a. Scrolling to the bottom in order to preload all the titles
      await page.evaluate(scrollToBottom);
      await page.waitForTimeout(Math.random() * 500 + 1000);

      console.log(postingsLinks);
      // 2. Iterate through the postings and extract information from each
      for (let id of postingsLinks) {
        console.log("Looking at: ", id);
        // 2a. Check to see if the posting title includes 'front', etc. If no, skip
        const jobTitle = await page.evaluate((id) => {
          return document.querySelector(
            `li[data-occludable-entity-urn='${id}'] .job-card-list__title`
          ).innerText;
        }, id);

        if (titleFilter(jobTitle)) {
          continue;
        }

        const postingClickDelay = Math.floor(Math.random() * 600) + 500;

        // 2b. Click on each individual li element within the ul job postings
        await Promise.all([
          page.click(`li[data-occludable-entity-urn='${id}']`),
          page.waitForNavigation(),
          page.waitForSelector(".mt5.mb2", { visible: true }),
        ]);

        await page.waitForTimeout(500);

        // 2c. Extract the information from each link; this can be separate function to grab the title, body, etc within a single function
        const [company, title, location, datePosted, url, description] =
          await page.evaluate(textExtractor);

        // 2d. Run a regex on the extracted text to decide whether you should filter it into the final validPostings
        // Removed

        // 2e. Check for available alumnis
        const availableAlumni = await page.evaluate(() => {
          return (
            /people/.test(document.querySelector(".mt5.mb2").innerHTML) &&
            [...document.querySelectorAll(".mt5.mb2 .app-aware-link")]
              .map((x) => x.getAttribute("href"))
              .filter((x) => /schoolFilter/.test(x)).length > 0
          );
        });

        // 2f. Push into valid postings
        validPostings.push({
          experienceMet: experienceFilter(description)[0] ? "yes" : "no",
          experienceRequired: experienceFilter(description)[1],
          company,
          title,
          location,
          datePosted,
          url,
          connections: availableAlumni ? "yes" : "no",
        });

        postingDescriptions.push(description);

        // 2g. Run a wait timer in order to prevent a 429 error
        await page.waitForTimeout(postingClickDelay);
      }
      // ---------------------------------------------------------------------------

      // 3. Reset the checkCondition
      nextPage++;
      checkCondition = await page.evaluate((nextPage) => {
        return document.querySelector(`button[aria-label="Page ${nextPage}"]`);
      }, nextPage);

      // 4. Jump to the next page
      if (checkCondition) {
        const nextPageClickDelay = Math.floor(Math.random() * 1000) + 500;

        await Promise.all([
          page.click(`button[aria-label="Page ${nextPage}"]`),
          page.waitForNavigation(),
          page.waitForTimeout(nextPageClickDelay),
        ]);
      }
    }

    console.log("Exiting try clause");
  } catch (e) {
    console.log("Entering catch clause");
    // Do something with error
    console.log(e);
  }

  return [validPostings];
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
  });

  const page = await browser.newPage();

  await Promise.all([
    page.setViewport({ width: 1440, height: 1000 }),
    page.goto(PAST_WEEK_EXPANDED_URL),
  ]);

  // Signing in
  console.log("Signing in");
  await signIn(page);

  // Scrape
  console.log("Initate scraping");
  const [validPostings] = await scrapePostings(browser, page, textExtractor);

  console.log("validPostings: ", validPostings);

  const formattedPostings = validPostings.map((post) => {
    const {
      experienceMet,
      experienceRequired,
      company,
      title,
      location,
      datePosted,
      url,
      connections,
    } = post;

    return `${experienceMet}\t${experienceRequired}\t${company}\t${title}\t${location}\t${datePosted}\t${url}\t${connections}`;
  });

  // Print Results
  fs.writeFile("./output.txt", formattedPostings.join("\n"), (e) => {
    if (e) return console.log(e);
    console.log("File successfully written");
  });
})();
