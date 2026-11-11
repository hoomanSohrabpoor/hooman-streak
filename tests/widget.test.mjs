// Runs the widget script under fake Scriptable globals to catch logic and runtime errors.
//
// `steps` scripts the user: each UITable that opens consumes steps until "close".
//   a number   taps that row of the current table (0 = first row)
//   "close"    closes the current table
// `answers` feeds dialogs in order:
//   "label"              picks the sheet action containing that text
//   { fields: [...] }    fills a text prompt and presses Save
//   { cancel: true }     cancels a prompt
//   { time: [h, m] }     answers a time picker
import { readFileSync } from "node:fs"
import assert from "node:assert/strict"

// Usage: node tests/widget.test.mjs [path to the widget script]
const scriptPath = process.argv[2] || new URL("../Hooman Streak.js", import.meta.url)
const src = readFileSync(scriptPath, "utf8")
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const DATA = "/docs/habit-widget-data.json"
const HOUR = 3600 * 1000

// Accepts any property, call or `new`; never pretends to be a Promise
const any = new Proxy(function () {}, {
  get: (_, prop) => (prop === "then" ? undefined : prop === Symbol.toPrimitive ? () => 0 : any),
  set: () => true,
  apply: () => any,
  construct: () => any,
})

function todayKey(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function makeEnv({ data, family = "medium", inWidget = true, steps = [], answers = [], query = {} } = {}) {
  steps = [...steps]
  answers = [...answers]
  const scheduled = []
  const store = data ? { [DATA]: typeof data === "string" ? data : JSON.stringify(data) } : {}
  const fm = {
    documentsDirectory: () => "/docs",
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: (p) => p in store,
    isFileStoredIniCloud: () => false,
    downloadFileFromiCloud: async () => {},
    readString: (p) => store[p],
    writeString: (p, s) => { store[p] = s },
  }
  class Notification {
    static async allPending() { return [...scheduled] }
    static async removePending(ids) {
      for (let i = scheduled.length - 1; i >= 0; i--) if (ids.includes(scheduled[i].identifier)) scheduled.splice(i, 1)
    }
    setTriggerDate(d) { this.at = d }
    schedule() { scheduled.push(this); return Promise.resolve() }
  }
  class Alert {
    constructor() { this.actions = []; this.fields = []; this.values = [] }
    addAction(t) { this.actions.push(t) }
    addDestructiveAction(t) { this.actions.push(t) }
    addCancelAction() {}
    addTextField(placeholder, value) { this.fields.push(value); return { setNumberPadKeyboard() {} } }
    textFieldValue(i) { return this.values[i] }
    async presentSheet() {
      const want = answers.shift()
      env.dialogs.push({ title: this.title, actions: this.actions })
      if (typeof want !== "string") return -1
      const index = this.actions.findIndex((a) => a.includes(want))
      assert.notEqual(index, -1, `no action "${want}" in ${JSON.stringify(this.actions)}`)
      return index
    }
    async presentAlert() {
      env.dialogs.push({ title: this.title, fields: this.fields })
      if (this.fields.length === 0) return 0 // a plain notice
      const want = answers.shift()
      if (!want || want.cancel) return -1
      this.values = want.fields
      return 0
    }
  }
  class DatePicker {
    async pickTime() {
      const want = answers.shift()
      if (!want || !want.time) throw new Error("cancelled")
      const d = new Date()
      d.setHours(want.time[0], want.time[1], 0, 0)
      return d
    }
  }
  class UITableRow {
    constructor() { this.cells = [] }
    addText(t, s) { const c = { title: t, subtitle: s, rightAligned() {}, centerAligned() {} }; this.cells.push(c); return c }
  }
  class UITable {
    constructor() { this.rows = [] }
    addRow(r) { this.rows.push(r) }
    removeAllRows() { this.rows = [] }
    reload() {}
    async present() {
      env.tables.push(this)
      while (steps.length && steps[0] !== "close") {
        const index = steps.shift()
        assert.ok(this.rows[index] && this.rows[index].onSelect, `row ${index} is not tappable`)
        await this.rows[index].onSelect()
      }
      steps.shift()
    }
    titles() { return this.rows.map((r) => r.cells.map((c) => c.title).join(" | ")) }
  }
  const env = {
    store, scheduled, dialogs: [], tables: [], widget: null,
    get saved() { return JSON.parse(store[DATA]) },
    get table() { return this.tables[0] },
    globals: {
      Color: any, Point: any, Font: any, Size: any, Rect: any, Path: any, DrawContext: any, SFSymbol: any,
      ListWidget: any, URLScheme: any, console,
      FileManager: { iCloud: () => { throw new Error("no iCloud") }, local: () => fm },
      Notification, Alert, DatePicker, UITable, UITableRow,
      Script: { setWidget: (w) => { env.widget = w }, complete: () => {} },
      config: { runsInWidget: inWidget, runsInApp: !inWidget, widgetFamily: family },
      args: { queryParameters: query },
    },
  }
  return env
}

async function run(env) {
  const names = Object.keys(env.globals)
  const fn = new AsyncFunction(...names, src + "\nreturn { currentStreak, summary, dayKey, addDays, applySettings, NOT_STARTED_MESSAGE, get TASKS() { return TASKS } }")
  return fn(...names.map((n) => env.globals[n]))
}

// Checklist rows: 0 header, 1 level, 2.. tasks, then hint, then Settings
const FASTAPI = 2, ENGLISH = 3, SETTINGS = 5

// 1. Every widget family renders, with and without a running timer
for (const timer of [null, { taskId: "fastapi", day: todayKey(), startedAt: Date.now() - HOUR }]) {
  for (const family of ["small", "medium", "large", "accessoryInline", "accessoryCircular", "accessoryRectangular"]) {
    const env = makeEnv({ family, data: timer ? { timer } : undefined })
    await run(env)
    assert.ok(env.widget, `widget for ${family}`)
  }
}

// 2. Streak logic
{
  const api = await run(makeEnv())
  const now = new Date(2026, 10, 11, 12)
  const key = (n) => api.dayKey(api.addDays(now, n))
  const all = api.TASKS.map((t) => t.id)
  const data = { days: { [key(-1)]: all, [key(-2)]: all, [key(-3)]: all.slice(1), [key(-4)]: all } }
  assert.equal(api.currentStreak(data, now), 2, "an unfinished today keeps yesterday's streak")
  data.days[key(0)] = all
  assert.equal(api.currentStreak(data, now), 3, "finishing today extends it")
  data.days[key(0)] = [all[0], "gone-task"]
  assert.equal(api.summary(data, now).left, all.length - 1, "removed task ids are ignored")
  delete data.days[key(-1)]
  delete data.days[key(0)]
  assert.equal(api.currentStreak(data, now), 0, "a missed yesterday resets the streak")
}

// 3. Plain task: tap ticks it, tap again unticks it
{
  let env = makeEnv({ inWidget: false, steps: [ENGLISH] })
  await run(env)
  assert.deepEqual(env.saved.days[todayKey()], ["english"])
  env = makeEnv({ inWidget: false, steps: [ENGLISH], data: env.saved })
  await run(env)
  assert.deepEqual(env.saved.days[todayKey()], [])
}

// 4. Tapping the widget's FastAPI line starts the timer; tapping again pauses and banks the time
{
  let env = makeEnv({ inWidget: false, query: { action: "timer", task: "fastapi" } })
  await run(env)
  assert.equal(env.saved.timer.taskId, "fastapi")
  assert.ok(env.scheduled.some((n) => n.identifier.endsWith("timer") && /time's up/.test(n.title)), "finish notification")
  assert.match(env.table.rows[FASTAPI].cells[1].subtitle, /Running · ends at/)

  const started = env.saved
  started.timer.startedAt -= 30 * 60 * 1000 // pretend 30 minutes passed
  env = makeEnv({ inWidget: false, query: { action: "timer", task: "fastapi" }, data: started })
  await run(env)
  assert.equal(env.saved.timer, null)
  const banked = env.saved.seconds[todayKey()].fastapi
  assert.ok(banked >= 1800 && banked < 1810, `banked ${banked}`)
  assert.match(env.table.rows[FASTAPI].cells[1].subtitle, /1:30 left of 2:00/)
}

// 5. When the 2 hours are up, the widget refresh ticks the task by itself
{
  const env = makeEnv({ data: { seconds: { [todayKey()]: { fastapi: 3600 } },
                               timer: { taskId: "fastapi", day: todayKey(), startedAt: Date.now() - HOUR - 1000 } } })
  await run(env)
  assert.deepEqual(env.saved.days[todayKey()], ["fastapi"])
  assert.equal(env.saved.timer, null)
}

// 6. A timer started before midnight credits the day it started
{
  const env = makeEnv({ data: { days: { [todayKey(-1)]: ["english"] },
                               timer: { taskId: "fastapi", day: todayKey(-1), startedAt: Date.now() - 3 * HOUR } } })
  await run(env)
  assert.deepEqual(env.saved.days[todayKey(-1)].sort(), ["english", "fastapi"])
  assert.equal(env.saved.complete[todayKey(-1)], true, "yesterday is recorded as complete")
}

// 7. Checklist menu: start, then "done, tick it" stops the timer and ticks
{
  let env = makeEnv({ inWidget: false, steps: [FASTAPI], answers: ["Start timer"] })
  await run(env)
  assert.equal(env.saved.timer.taskId, "fastapi")
  env = makeEnv({ inWidget: false, steps: [FASTAPI, ENGLISH], answers: ["Done, tick it"], data: env.saved })
  await run(env)
  assert.equal(env.saved.timer, null)
  assert.deepEqual(env.saved.days[todayKey()].sort(), ["english", "fastapi"])
  assert.ok(env.scheduled.every((n) => !n.identifier.includes(todayKey())), "no reminders left for a finished day")
  assert.match(env.table.rows[0].cells[0].title, /🔥 1-day streak/)
  assert.match(env.table.rows[0].cells[0].subtitle, /Great job, Hooman/)
}

// 8. Corrupt data file doesn't crash the widget
{
  const env = makeEnv({ data: "{not json" })
  await run(env)
  assert.ok(env.widget)
}

// 9. Everything the phone shows is English
{
  const env = makeEnv({ inWidget: false, query: { action: "timer", task: "fastapi" }, steps: [SETTINGS, "close"] })
  await run(env)
  const shown = [...env.scheduled.flatMap((n) => [n.title, n.body]),
                 ...env.tables.flatMap((t) => t.rows.flatMap((r) => r.cells.flatMap((c) => [c.title, c.subtitle])))]
    .filter(Boolean)
  for (const text of shown) assert.doesNotMatch(text, /[؀-ۿ]/, text)
}

// 10. The red sentence shows until something is started, then disappears
{
  let env = makeEnv({ inWidget: false })
  const api = await run(env)
  assert.equal(env.table.rows[0].cells[0].subtitle, api.NOT_STARTED_MESSAGE)
  env = makeEnv({ inWidget: false, query: { action: "timer", task: "fastapi" } })
  await run(env)
  assert.notEqual(env.table.rows[0].cells[0].subtitle, api.NOT_STARTED_MESSAGE)
  const paused = { ...env.saved, timer: null, seconds: { [todayKey()]: { fastapi: 60 } } }
  env = makeEnv({ inWidget: false, data: paused })
  await run(env)
  assert.notEqual(env.table.rows[0].cells[0].subtitle, api.NOT_STARTED_MESSAGE, "banked time counts as started")
}

// 11. The ring counts timer time: 1 of 2 hours on FastAPI = a quarter of the day's goal
{
  const api = await run(makeEnv())
  const data = { days: {}, seconds: { [todayKey()]: { fastapi: 3600 } }, timer: null, complete: {} }
  assert.equal(api.summary(data).progress, 0.25)
  data.days[todayKey()] = ["english"]
  assert.equal(api.summary(data).progress, 0.75)
}

// 12. Reaching a 7-day streak levels up once, with a notification
{
  const all = ["fastapi", "english"]
  const days = {}
  for (let i = 1; i <= 6; i++) days[todayKey(-i)] = all
  let env = makeEnv({ inWidget: false, steps: [FASTAPI, ENGLISH], answers: ["Tick without timer"], data: { days, level: 0 } })
  await run(env)
  assert.equal(env.saved.level, 1)
  const levelUps = env.scheduled.filter((n) => n.identifier.startsWith("habit-level-"))
  assert.equal(levelUps.length, 1)
  assert.match(levelUps[0].title, /Week Warrior/)
  assert.match(env.table.rows[1].cells[0].title, /Week Warrior/)
  assert.match(env.table.rows[1].cells[0].subtitle, /23 days to Monthly Master/)
  env = makeEnv({ inWidget: false, data: env.saved })
  await run(env)
  assert.equal(env.scheduled.filter((n) => n.identifier.startsWith("habit-level-")).length, 0, "no second notification")
}

// ---------- settings ----------
// Settings rows: 0 TASKS header, 1 FastAPI, 2 English, 3 Add task, 4 GOAL header, 5 goal,
//                6 REMINDERS header, 7 09:00, 8 16:00, 9 21:30, 10 Add reminder, 11 OTHER, 12 Reset

// 13. Adding a task keeps the streak: past days stay complete under the tasks they had
{
  const days = {}
  for (let i = 1; i <= 3; i++) days[todayKey(-i)] = ["fastapi", "english"]
  const env = makeEnv({
    inWidget: false, data: { days },
    steps: [SETTINGS, 3, "close"],
    answers: [{ fields: ["Gym", "🏋️", "45"] }],
  })
  const api = await run(env)
  const tasks = env.saved.settings.tasks
  assert.equal(tasks.length, 3)
  assert.deepEqual([tasks[2].title, tasks[2].emoji, tasks[2].minutes], ["Gym", "🏋️", 45])
  assert.match(env.tables[0].titles()[4], /Gym/, "checklist shows the new task after closing settings")
  api.applySettings(env.saved)
  assert.equal(api.currentStreak(env.saved, new Date()), 3, "streak survives a new task")
}

// 14. Rename, change timer, move up, remove timer, delete
{
  let env = makeEnv({
    inWidget: false,
    steps: [SETTINGS, 1, 1, 2, 2, "close"],
    answers: ["Rename", { fields: ["FastAPI deep work"] },
              "Change timer", { fields: ["90"] },
              "Move up",       // English moves above FastAPI
              "Remove timer"], // row 2 is now FastAPI
  })
  await run(env)
  assert.deepEqual(env.saved.settings.tasks.map((t) => [t.id, t.title, t.minutes]),
                   [["english", "Read English books", undefined], ["fastapi", "FastAPI deep work", undefined]])

  env = makeEnv({ inWidget: false, data: env.saved, steps: [SETTINGS, 1, "close"], answers: ["Delete task"] })
  await run(env)
  assert.deepEqual(env.saved.settings.tasks.map((t) => t.id), ["fastapi"])
  // One task left, so the checklist's Settings row moves up to 4
  env = makeEnv({ inWidget: false, data: env.saved, steps: [4, 1, "close"], answers: ["Delete task"] })
  await run(env)
  assert.deepEqual(env.saved.settings.tasks.map((t) => t.id), ["fastapi"], "the last task can't be deleted")
  assert.ok(env.dialogs.some((d) => d.title === "Can't delete"))
}

// 15. Bad input is refused without saving anything
{
  const env = makeEnv({
    inWidget: false, steps: [SETTINGS, 3, 3, 3, "close"],
    answers: [{ fields: ["", "✅", ""] }, { fields: ["Run", "🏃", "abc"] }, { cancel: true }],
  })
  await run(env)
  assert.equal(env.saved.settings, null)
  assert.ok(env.dialogs.some((d) => d.title === "No title"))
  assert.ok(env.dialogs.some((d) => d.title === "Invalid timer"))
}

// 16. Daily goal: 1 of 2 tasks makes a single tick complete the day
{
  const env = makeEnv({ inWidget: false, steps: [SETTINGS, 5, "close", ENGLISH], answers: ["1 of 2"] })
  await run(env)
  assert.equal(env.saved.settings.goal, 1)
  assert.equal(env.saved.complete[todayKey()], true)
  assert.match(env.table.rows[0].cells[0].title, /1-day streak/)
}

// 17. Reminders: add, change, delete; the latest time becomes the warning
{
  const env = makeEnv({
    inWidget: false,
    steps: [SETTINGS, 10, 7, 10, "close"],
    answers: [{ time: [23, 15] },                 // add 23:15 -> rows 7..10 are 09:00 16:00 21:30 23:15
              "Change time", { time: [8, 30] },   // 09:00 -> 08:30
              "Delete reminder"],                 // row 10 is 23:15... then delete it
  })
  await run(env)
  const times = env.saved.settings.reminders.map((r) => `${r.hour}:${r.minute}`).sort()
  assert.deepEqual(times, ["16:0", "21:30", "8:30"])
  const settingsTable = env.tables[1]
  assert.match(settingsTable.rows.find((r) => /21:30/.test(r.cells[0].title)).cells[0].subtitle, /Streak-at-risk/)
}

// 18. Reset brings the defaults back
{
  let env = makeEnv({ inWidget: false, steps: [SETTINGS, 3, "close"], answers: [{ fields: ["Gym", "🏋️", ""] }] })
  await run(env)
  // With 3 tasks the checklist's Settings row is 6, and Reset is 13 in the settings screen
  env = makeEnv({ inWidget: false, data: env.saved, steps: [6, 13, "close"], answers: ["Reset"] })
  await run(env)
  assert.equal(env.saved.settings, null)
  assert.equal(env.tables[0].titles().filter((t) => /Gym/.test(t)).length, 0)
}

console.log("all widget tests passed")
