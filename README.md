# linkedin-web-scraper
Speed up your LinkedIn job search by automating the process! 

## Directions
1. Add a `.env` file with your LinkedIn credentials:

    ```javascript
      LI_USER=username
      LI_PASS=password
    ```
2. Add to the `LINKS` object URLs that you want to job scrape. Filters can also be added as they're saved in the query params of each LinkedIn URL
3. Update the `titleFilter` and `experienceFilter` to match your needs
4. Run `npm run start` 
    * If ran successfully, results should be saved within a `output.txt` file
    * Note that this program will need to be updated periodically to be functional as LinkedIn updates their ui


