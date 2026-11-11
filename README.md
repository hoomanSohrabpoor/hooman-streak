# Hooman Streak 🔥

A Duolingo-style streak widget for iPhone that keeps me working on my daily goals: two hours of FastAPI practice and reading English books.

It runs on [Scriptable](https://scriptable.app), so it needs no Mac, no Xcode and no App Store account.

## Features

- **Streak with levels.** The flame and progress ring change color as the streak grows: orange (Spark), blue at 7 days (Week Warrior), purple at 30 (Monthly Master), gold at 100 (Legend). Each new level sends a notification.
- **Progress ring.** Fills as tasks are ticked. Timed tasks fill it gradually as you work.
- **Task timers.** Tap ▶️ on the widget to start a countdown that ticks live on the home screen. Pause and resume any time; when it reaches zero, the task ticks itself.
- **Reminders that escalate.** Morning, afternoon, and an evening "your streak is at risk" warning. They stop for the day once everything is done.
- **A daily quote until you start.** A short motivational line, a new one each day, stays on the widget until the day's first timer or tick.
- **In-app settings.** Add, rename, reorder or delete tasks, set timers, choose how many tasks keep the streak alive, and edit reminder times.
- **Home screen and lock screen.** Small and medium home screen widgets, plus circular, rectangular and inline lock screen widgets.
- **Last 7 days** at a glance on the medium widget.

## Install

1. Install [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) from the App Store and open it once.
2. Get `Hooman Streak.js` onto the phone (AirDrop, email, a chat app).
3. Put it into Scriptable:
   - **With iCloud Drive:** in the share sheet, choose *Save to Files* → *iCloud Drive* → *Scriptable*.
   - **Without iCloud Drive:** save the file anywhere in *Files*. In Scriptable, tap **+**, paste the contents of [`installer.js`](installer.js), run it, and pick the file. It copies the widget into Scriptable.
4. Run **Hooman Streak** once in Scriptable and allow notifications.
5. Add a Scriptable widget to the home screen or lock screen, tap *Edit Widget*, and choose **Hooman Streak** as the script.

## Usage

- **Tap a timed task's line** on the widget to start or pause its timer.
- **Tap anywhere else** on the widget to open the checklist. Tap a task to tick or untick it.
- **⚙️ Settings** at the bottom of the checklist edits tasks, timers, the daily goal and reminders.

The name shown on the widget and in notifications, the daily quotes and the level thresholds are set at the top of the script.

## How it works

Everything lives in one JSON file in Scriptable's documents folder (iCloud when available, otherwise on the device):

| Key | Purpose |
|---|---|
| `days` | Task ids ticked on each day |
| `seconds` | Time banked by paused timers, per day and task |
| `timer` | The running timer: task, day and start time |
| `complete` | Each day's result, frozen once the day is over |
| `settings` | Tasks, reminders and goal edited in the app |

A few design decisions worth noting:

- **Timers are timestamps, not ticking processes.** A running timer stores only its start time. Elapsed time is computed whenever the script runs, so it stays correct while the phone is locked or Scriptable is closed. The widget shows a live countdown with iOS's built-in timer text, which keeps ticking without re-running the script.
- **History is frozen per day.** Each day's result is recorded under the tasks that existed that day. Adding a new task later doesn't turn past days incomplete and break the streak.
- **A timer that crosses midnight** credits the day it was started.
- **Like Duolingo, today doesn't break the streak until midnight.** An unfinished today still shows yesterday's streak.
- **Reminders are re-planned on every run** for the next few days (iOS allows at most 64 pending notifications), and today's are dropped once the day is complete.

## Tests

Scriptable only runs on iOS, so the tests run the widget in Node.js against a fake Scriptable API. They script taps, dialogs and time pickers, and check streaks, timers, level-ups, settings and that all on-screen text is English.

```bash
npm test
```

19 test scenarios, no dependencies (Node.js 18+).

## Built with AI

I built this with Claude as an AI pair programmer. I described what I wanted, tested it on my phone, and iterated: English-only UI, the timer, the levels and ring, and the settings screen all came out of that back-and-forth.

## Known limitations

- iOS decides when widgets refresh, so a tick can take a few minutes to show on the widget.
- Lock screen widgets are monochrome; iOS doesn't allow colors there.
- Widget buttons open Scriptable for a moment, because Scriptable widgets can't run actions in place like native iOS 17 widgets.
