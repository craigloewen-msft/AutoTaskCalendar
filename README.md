This repository's goal is to make a web interface to manage your daily tasks and automatically schedule them on your calendar.

## Use codespaces 

This project is set up with codespaces. If you launch the project with codespaces and then run `npm run dev` in the root directory you will get set up immediately.

### Testing with Pre-populated Data

To test the application with sample data and a test user, run:

```bash
npm run seed
```

Then login with:
- **Username:** `testuser`
- **Password:** `testpassword`

See [TEST_CREDENTIALS.md](TEST_CREDENTIALS.md) for more details about the test user and sample data. 

## Set up locally

1. Have a MongoDB running. The easiest way to do this is in WSL.
  * `sudo apt install docker` to make sure you have docker.
  * `sudo service docker start` will start Docker as a service
  * `sudo docker run -d -p 27017:27017 --name mongo mongo:latest` will start a docker container running mongodb.
    - if you've already created the container once, then just `sudo docker run -d -p 27017:27017 mongo` will suffice.
2. Run `npm install` to get the right packages
  * make sure that you have an up to date `node`. See [NodeSource Node.js Binary Distributions](https://github.com/nodesource/distributions/blob/master/README.md)
  * First do an `npm install` in the root`
  * `cd webinterface/ ; npm install` in that directory too.
3. Change `devMongoDBConnectionString` in `defaultconfig.js` to `mongodb://localhost/GithubIssueManagement` so it points to your local instance rather than the docker-compose ready version
4. (Optional) Seed the database with test data:
  * Run `npm run seed` to create a test user with sample tasks and events
  * See [TEST_CREDENTIALS.md](TEST_CREDENTIALS.md) for login credentials
5. Run the webserver:
  * in the project root, `node app.js` will start the backend
  * in `webinterface/`, `npm run serve` will start the frontend.
4. Navigate to `http://localhost:8080/#/` to view the website.
  * If you seeded the database, login with username `testuser` and password `testpassword`

The frontend will hot reload, but the backend won't.

### Further set up
* You can replace `defaultconfig.js` with your actual one once you want to go live.
* You will probably want to generate a github API token. Copy `defaultconfig.js` to `config.js`, and stick that in `ghToken` in `config.js`, so that you don't instantly run into the rate limit.

## Google Analytics Configuration

This application is integrated with Google Analytics using the modern `vue-gtag` plugin. To enable analytics tracking:

1. **Get a Google Analytics Measurement ID:**
   - Create a Google Analytics 4 property at [https://analytics.google.com](https://analytics.google.com)
   - Get your Measurement ID (format: `G-XXXXXXXXXX`)

2. **Configure the Measurement ID:**
   
   **For Development:**
   ```bash
   export VUE_APP_GA_MEASUREMENT_ID=G-XXXXXXXXXX
   npm run dev
   ```
   
   **For Production Build:**
   ```bash
   VUE_APP_GA_MEASUREMENT_ID=G-XXXXXXXXXX npm run build
   ```
   
   **For Permanent Configuration:**
   Create a `.env.local` file in the `webinterface/` directory:
   ```
   VUE_APP_GA_MEASUREMENT_ID=G-XXXXXXXXXX
   ```

3. **What Gets Tracked:**
   - **Page Views:** Automatically tracked on all routes
   - **User Registration:** Tracked when a new user registers
   - **User Login:** Tracked when a user logs in
   - **User Logout:** Tracked when a user logs out

**Note:** If `VUE_APP_GA_MEASUREMENT_ID` is not set, Google Analytics will be disabled (useful for development and testing).
