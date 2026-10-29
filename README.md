# Mouse Mayhem

A lightweight real-time 2-player browser duel. Plain HTML/CSS/JS + Supabase Realtime, hosted on GitHub Pages.

## Project structure

```
mouse-mayhem/
├── index.html              # menu, waiting room, arena, victory screens
├── style.css                # all visual styling
├── supabase-setup.sql       # run once in Supabase SQL editor
└── js/
    ├── supabaseClient.js    # your Supabase URL + anon key go here
    ├── main.js               # menu, room create/join, presence
    └── game.js               # arena, cursors, combat, HP, victory
```

## 1. Create the Supabase project

1. Go to supabase.com → New project. Pick any name/region/password.
2. Wait for it to finish provisioning (~2 min).
3. In the left sidebar: **SQL Editor** → New query → paste the contents of `supabase-setup.sql` → **Run**.
   This creates the `rooms` table and the Row Level Security policies that let two strangers create/join rooms safely with the public anon key.
4. In the left sidebar: **Project Settings → API**. Copy:
   - **Project URL**
   - **anon / public** key (NOT the `service_role` key — never put that in client code)
5. Open `js/supabaseClient.js` and paste them in:
   ```js
   const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```
6. Realtime is on by default for new projects, and Broadcast/Presence (which this game uses) don't need any table added to a publication — so there's nothing else to configure there.

## 2. Run it locally first

You can't just double-click `index.html` because of how browsers handle module/script loading with some setups — but a plain static server works fine:

```bash
cd mouse-mayhem
python3 -m http.server 8080
# visit http://localhost:8080
```

Open that URL in two different browser windows (or one normal + one incognito) to test both player slots on one machine before trying two separate computers.

## 3. Deploy to GitHub Pages

1. Create a new GitHub repo, e.g. `mouse-mayhem`.
2. Push this folder's contents to the repo root:
   ```bash
   git init
   git add .
   git commit -m "Mouse Mayhem"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/mouse-mayhem.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / (root)** → Save.
4. After a minute, your game is live at:
   `https://YOUR_USERNAME.github.io/mouse-mayhem/`
5. Share that link with a friend on a different computer/network. One of you clicks **Create Room**, sends the code, the other clicks **Join Room** and enters it.

## 4. How the multiplayer actually works

- **Room creation/joining** uses a `rooms` table in Postgres. Joining does a conditional `UPDATE ... WHERE status = 'waiting'` — if two people try to grab the same room at once, only one `UPDATE` can succeed, which is what prevents duplicate player-2 slots.
- **Live state during the match** (cursor positions, attacks, health, defeat) goes over a Supabase Realtime channel named `room:<CODE>`, using `broadcast` for events and `presence` to know who's currently connected.
- **Disconnect/reconnect:** Presence `leave`/`join` events flip the connection indicator. If your opponent's tab closes, you'll see "opponent disconnected" — there's currently no automatic forfeit timer; that's a reasonable next feature to add if you want it.
- **Invalid room codes** and **full rooms** are checked against the `rooms` table before attempting to join, with a clear on-screen error.

## 5. Important honesty note about "server-side validation"

You asked for an authoritative mechanism that stops a client from just deciding it won. With **only Supabase (Postgres + Realtime) and GitHub Pages — no custom backend**, there is no real game server watching the match live, so I could not build true server-side combat validation. What I built instead, to get as close as is possible with this stack:

- Each player's HP is a value **only that player's own browser is allowed to change**. The opponent can tell you "I fired a shot from here, in this direction" over the realtime channel, but **your own client** decides, using its own cursor position, whether that shot actually hit you — then reports its own new HP.
- A malicious player could tamper with their own client to lie about their own HP (e.g. refuse to take damage, or just not send losses) — they cannot, however, directly set the opponent's HP or unilaterally mark the opponent defeated.
- A real anti-cheat / fully authoritative version would need a small backend that owns both players' HP — a Supabase **Edge Function** acting as referee is the natural next step, but that's genuinely more work than fits here and I did not build it. I'd rather tell you that plainly than ship something that quietly doesn't do what was asked.

## 6. What I could not test myself

I don't have a live two-computer setup to actually play this end-to-end, so I can't personally confirm there are zero sync bugs across real network latency. I did:
- Keep all shared state changes going through the realtime channel rather than local-only logic.
- Make each player's own cursor position authoritative for their own hit detection (not something an opponent's client can forge the result of).
- Handle the empty/duplicate/invalid room cases in the database layer, not just in the UI.

Please test with two real machines before trusting it for anything beyond casual play, and treat the "Important honesty note" above as the real security boundary of this build.

## 7. Suggested next improvements

- A forfeit/auto-win timer if a player disconnects mid-match.
- A Supabase Edge Function as a real combat referee (true anti-cheat).
- Mobile/touch support (currently mouse-only, as requested).
- Room expiry cleanup (a scheduled SQL job deleting old `rooms` rows).
