# Connect Gmail and Google Calendar

From step 5 (outreach) on, Hireloop sends real emails and reads the replies. This guide connects it to Google.
It takes about 15 minutes and costs nothing.

## You'll use two Gmail accounts

| Account | Plays | Example |
|---|---|---|
| **Recruiter** | You. Hireloop signs in to it, reads briefs from its `Briefs` label, sends emails and books interviews from it. | `you@gmail.com` |
| **Test inbox** | Every candidate and client. Demo candidates get addresses like `you.test+12@gmail.com`, which Gmail delivers to this inbox. You reply from here to play them. | `you.test@gmail.com` |

Hireloop only ever sends to the test inbox (and its `+` variants) and to the addresses you allow-list. Any other
address is refused in code, so no real person can be emailed by mistake.

## 1. Create a Google Cloud project

1. Open [console.cloud.google.com](https://console.cloud.google.com) and sign in with the **recruiter** account.
2. Click the project picker (top left) → **New project**. Name it `hireloop` → **Create**, then select it.

## 2. Turn on the Gmail and Calendar APIs

1. Go to **APIs & Services → Library**.
2. Search **Gmail API** → **Enable**.
3. Back to the Library, search **Google Calendar API** → **Enable**.

## 3. Set up the consent screen

1. Go to **APIs & Services → OAuth consent screen** (also called **Google Auth Platform**) → **Get started**.
2. App name `Hireloop`, support email = your recruiter address → **Next**.
3. Audience: **External** → **Next**. Contact email: yours → **Next** → agree → **Create**.
4. Open **Audience** → under **Test users** click **Add users** → add your **recruiter** address → **Save**.

Leave the app in **Testing**. You don't need to submit it for verification.

## 4. Create the OAuth client

1. Go to **APIs & Services → Credentials** → **Create credentials → OAuth client ID**.
2. Application type: **Web application**. Name: `Hireloop local`.
3. Under **Authorized redirect URIs** click **Add URI** and paste:
   ```
   http://localhost:3000/api/google/callback
   ```
4. **Create**. Copy the **Client ID** and the **Client secret**.

## 5. Add the keys in Hireloop

1. In Hireloop, click the **mail icon** in the left rail.
2. Paste the **OAuth client ID** and **OAuth client secret**.
3. Type your **Test inbox** address (for example `you.test@gmail.com`).
4. Click **Save and check**.
5. Point the demo candidates and clients at your test inbox by seeding again:
   ```bash
   npm run db:seed
   ```

You can put the same values in `.env.local` instead (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_TEST_INBOX`). See [.env.example](../.env.example).

## 6. Connect Gmail

1. In the same mail icon menu, click **Connect Gmail** (it turns green once the client ID and secret are saved).
2. Sign in with the **recruiter** account.
3. Google says *"Google hasn't verified this app"*. That's expected for your own test app: click **Continue**.
4. **Tick every box** (read Gmail, send email, calendar events, free/busy) → **Continue**.

The mail icon now has a green dot. Click it to see the connected account or to disconnect.

## 7. Try it

- **A brief by email:** in the recruiter Gmail, create a label called `Briefs`. From the test inbox, email the
  recruiter a job brief. Put it under the `Briefs` label, then click **Check Gmail** on the Briefs page.
- **Outreach:** approve a draft in the approval queue. It arrives in the test inbox as a separate conversation per
  candidate. Reply from there ("Sounds interesting, tell me more"), then click **Check replies** on the job page.

## Good to know

- **Logins expire after 7 days** while the Google app is in Testing. The mail icon turns amber; click it and
  **Connect again**.
- **What Hireloop can see:** only emails under the `Briefs` label and the threads it started itself, plus your
  calendar's free/busy times (never event details). It never labels, moves or deletes anything in Gmail.
- **Where the login lives:** the Google refresh token is stored in your local database (`google_accounts` table),
  never in a file or in git. **Disconnect** removes it and revokes it at Google.
- **Different port?** If you run the app somewhere other than `localhost:3000`, set `GOOGLE_REDIRECT_URI` in
  `.env.local` and add the same URI to the OAuth client.
