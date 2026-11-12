// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-orange; icon-glyph: fire;

// ============================ SETTINGS: edit only this part ============================
// Tasks, timers, the daily goal and reminder times can also be changed in the app:
// tap the widget, then ⚙️ Settings. Once you do, the app's settings replace the
// defaults below (use "Reset to defaults" there to come back to them).

// Shown on the widget, in the app and in notifications
const OWNER_NAME = "Hooman"

// Your daily tasks. Each needs a unique id, a title and an emoji.
// Add "minutes" to give a task a timer: it ticks itself when the time is up.
const DEFAULT_TASKS = [
  { id: "fastapi", title: "FastAPI practice", emoji: "💻", minutes: 120 },
  { id: "english", title: "Read English books", emoji: "📖" },
]

// Reminder times (24-hour clock). The last one is the "streak at risk" warning.
const DEFAULT_REMINDERS = [
  { hour: 9, minute: 0 },
  { hour: 16, minute: 0 },
  { hour: 21, minute: 30 },
]

// One line a day, shown until you start something (start a timer or tick a task).
// The same line stays all day and the next one appears after midnight.
const DAILY_QUOTES = [
  "Small steps, every single day.",
  "Start now. Perfect it later.",
  "Discipline beats motivation.",
  "One hour today beats ten someday.",
  "Your future self is watching.",
  "Done is better than perfect.",
  "Showing up is the hard part.",
  "Consistency compounds.",
  "Code a little, learn a lot.",
  "Every expert was once a beginner.",
  "Don't break the chain.",
  "Progress, not perfection.",
  "The best time to start is now.",
  "Make today count.",
  "Read one page. Then another.",
  "Hard now, easy later.",
  "Just take the next small step.",
  "You don't need more time. Just start.",
  "Learn it today, use it tomorrow.",
  "Momentum starts with one task.",
  "Ship something today.",
  "Be stubborn about your goals.",
  "Ten minutes is enough to begin.",
  "Effort today, results tomorrow.",
  "Your streak is waiting for you.",
  "Bugs today, skills tomorrow.",
  "One more chapter, one more commit.",
  "Keep the flame alive.",
  "Practice makes progress.",
  "Start before you feel ready.",
  "Turn \"later\" into \"now\".",
]

// Streak levels: the flame and ring take the color of the level you've reached
const LEVELS = [
  { days: 0, title: "Spark", color: "#FF9600" },
  { days: 7, title: "Week Warrior", color: "#1CB0F6" },
  { days: 30, title: "Monthly Master", color: "#CE82FF" },
  { days: 100, title: "Legend", color: "#FFC800" },
]

// =======================================================================================

// The active tasks, reminders and daily goal: from the in-app settings, or the defaults above
let TASKS = DEFAULT_TASKS
let REMINDERS = DEFAULT_REMINDERS
let GOAL = TASKS.length

function applySettings(data) {
  const settings = data.settings
  TASKS = settings && settings.tasks.length ? settings.tasks : DEFAULT_TASKS
  // Sorted by time, so the last one is always the evening "streak at risk" warning
  REMINDERS = [...(settings ? settings.reminders : DEFAULT_REMINDERS)]
    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute))
  // goal null = all tasks
  GOAL = Math.min(Math.max((settings && settings.goal) || TASKS.length, 1), TASKS.length)
}

const COLORS = {
  bg: new Color("#131F24"),
  flame: new Color("#FF9600"),
  done: new Color("#58CC02"),
  muted: new Color("#52656D"),
  text: Color.white(),
  sub: new Color("#AFC2CA"),
}
LEVELS.sort((a, b) => a.days - b.days)
const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] // Date.getDay(): Sunday..Saturday
const NOTIFICATION_PREFIX = "habit-widget-"
const BRAND = `${OWNER_NAME.toUpperCase()}'S DAILY`

// iCloud keeps the history if the phone is replaced; fall back to local storage without it
const fm = (() => {
  try {
    const icloud = FileManager.iCloud()
    icloud.documentsDirectory()
    return icloud
  } catch (e) {
    return FileManager.local()
  }
})()
const dataPath = fm.joinPath(fm.documentsDirectory(), "habit-widget-data.json")

// ---------- helpers ----------

function pad(n) {
  return String(n).padStart(2, "0")
}

function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

// 5400 seconds -> "1:30"
function formatDuration(seconds) {
  const minutes = Math.ceil(seconds / 60)
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`
}

function formatClock(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function taskById(id) {
  return TASKS.find((t) => t.id === id)
}

// ---------- data ----------
// { days: { "2026-11-11": ["english"] },
//   seconds: { "2026-11-11": { fastapi: 3600 } },   time banked by paused timers
//   timer: { taskId, day, startedAt } | null,        the running timer, if any
//   complete: { "2026-11-10": true },                each day's result, frozen once the day is over
//   level: 1,                                        last level reached, to notify on level-up
//   settings: { tasks, reminders, goal } | null }    set from the app's Settings screen

async function loadData() {
  let raw = null
  if (fm.fileExists(dataPath)) {
    if (fm.isFileStoredIniCloud(dataPath)) await fm.downloadFileFromiCloud(dataPath)
    try {
      raw = JSON.parse(fm.readString(dataPath))
    } catch (e) {
      raw = null
    }
  }
  raw = raw && typeof raw === "object" ? raw : {}
  const settings = raw.settings
  const data = {
    days: raw.days || {},
    seconds: raw.seconds || {},
    timer: raw.timer || null,
    complete: raw.complete || null,
    level: typeof raw.level === "number" ? raw.level : null,
    settings: settings && Array.isArray(settings.tasks) && Array.isArray(settings.reminders) ? settings : null,
  }
  applySettings(data)
  if (!data.complete) {
    // First run that keeps per-day results: record the history under the current tasks
    data.complete = {}
    for (const key of Object.keys(data.days)) recordDay(data, key)
  }
  return data
}

function saveData(data) {
  // About a year of history is plenty and keeps the file small
  const cutoff = dayKey(addDays(new Date(), -400))
  for (const bucket of [data.days, data.seconds, data.complete]) {
    for (const key of Object.keys(bucket)) {
      if (key < cutoff) delete bucket[key]
    }
  }
  fm.writeString(dataPath, JSON.stringify(data))
}

function doneIds(data, key) {
  // Ignore ids of tasks that were later removed from TASKS
  const valid = new Set(TASKS.map((t) => t.id))
  return (data.days[key] || []).filter((id) => valid.has(id))
}

// Judged against today's tasks and goal
function liveComplete(data, key) {
  return doneIds(data, key).length >= GOAL
}

function recordDay(data, key) {
  data.complete[key] = liveComplete(data, key)
}

// Past days keep the result they had, so adding or removing tasks never breaks the streak
function isComplete(data, key, today = dayKey(new Date())) {
  if (key !== today && data.complete && key in data.complete) return data.complete[key]
  return liveComplete(data, key)
}

// Like Duolingo: an unfinished today doesn't break the streak until midnight
function currentStreak(data, now) {
  const today = dayKey(now)
  let day = isComplete(data, today, today) ? now : addDays(now, -1)
  let count = 0
  while (isComplete(data, dayKey(day), today)) {
    count++
    day = addDays(day, -1)
  }
  return count
}

function markDone(data, key, id) {
  const done = new Set(data.days[key] || [])
  done.add(id)
  data.days[key] = [...done]
}

function toggleTask(data, key, id) {
  const done = new Set(data.days[key] || [])
  if (done.has(id)) done.delete(id)
  else done.add(id)
  data.days[key] = [...done]
}

// Anything happened today: a task ticked or a timer started
function hasStarted(data, key) {
  if (doneIds(data, key).length > 0) return true
  if (data.timer && data.timer.day === key) return true
  return Object.values(data.seconds[key] || {}).some((s) => s > 0)
}

// 0..1 for the ring: ticked tasks count fully, timed tasks count by time worked
function dayProgress(data, key, now = Date.now()) {
  const done = new Set(doneIds(data, key))
  let total = 0
  for (const task of TASKS) {
    if (done.has(task.id)) total += 1
    else if (task.minutes) total += Math.min(1, workedSeconds(data, key, task.id, now) / (task.minutes * 60))
  }
  return Math.min(1, total / GOAL)
}

function level(streak) {
  let index = 0
  LEVELS.forEach((l, i) => {
    if (streak >= l.days) index = i
  })
  return { ...LEVELS[index], index, color: new Color(LEVELS[index].color), next: LEVELS[index + 1] || null }
}

function summary(data, now = new Date()) {
  const key = dayKey(now)
  const done = doneIds(data, key).length
  return {
    key,
    done,
    left: Math.max(GOAL - done, 0),
    complete: done >= GOAL,
    started: hasStarted(data, key),
    progress: dayProgress(data, key, now.getTime()),
    streak: currentStreak(data, now),
  }
}

// Notify once when the streak reaches a new level
function checkLevelUp(data, notify = true) {
  const s = summary(data)
  const lv = level(s.streak)
  const previous = data.level
  data.level = lv.index
  if (!notify || previous === null || lv.index <= previous) return
  const n = new Notification()
  // A separate prefix, so re-planning the reminders never cancels it
  n.identifier = `habit-level-${lv.index}-${s.key}`
  n.title = `🏆 New level, ${OWNER_NAME}: ${lv.title}!`
  n.body = `${s.streak}-day streak. Your flame just changed color 🔥`
  n.sound = "default"
  n.schedule()
}

// ---------- timer ----------

function bankedSeconds(data, key, id) {
  return (data.seconds[key] || {})[id] || 0
}

function workedSeconds(data, key, id, now = Date.now()) {
  let total = bankedSeconds(data, key, id)
  const t = data.timer
  if (t && t.taskId === id && t.day === key) total += Math.max(0, (now - t.startedAt) / 1000)
  return total
}

function remainingSeconds(data, key, task, now = Date.now()) {
  return Math.max(0, task.minutes * 60 - workedSeconds(data, key, task.id, now))
}

function isRunning(data, id) {
  return Boolean(data.timer && data.timer.taskId === id)
}

// When the running timer reaches zero
function timerEnd(data) {
  const t = data.timer
  const task = t && taskById(t.taskId)
  if (!task || !task.minutes) return null
  return new Date(t.startedAt + (task.minutes * 60 - bankedSeconds(data, t.day, t.taskId)) * 1000)
}

function pauseTimer(data, now = Date.now()) {
  const t = data.timer
  if (!t) return
  data.seconds[t.day] = data.seconds[t.day] || {}
  data.seconds[t.day][t.taskId] = bankedSeconds(data, t.day, t.taskId) + Math.max(0, (now - t.startedAt) / 1000)
  data.timer = null
}

function startTimer(data, id, now = Date.now()) {
  // Only one timer at a time
  pauseTimer(data, now)
  data.timer = { taskId: id, day: dayKey(new Date(now)), startedAt: now }
}

// Once the running timer has reached its target, stop it and tick the task.
// The credit goes to the day the timer was started, even if it ends after midnight.
function settleTimer(data, now = Date.now()) {
  const t = data.timer
  if (!t) return false
  const task = taskById(t.taskId)
  if (!task || !task.minutes) {
    data.timer = null
    return true
  }
  if (workedSeconds(data, t.day, t.taskId, now) < task.minutes * 60) return false
  pauseTimer(data, now)
  markDone(data, t.day, t.taskId)
  return true
}

function timerURL(id) {
  return `${URLScheme.forRunningScript()}?action=timer&task=${encodeURIComponent(id)}`
}

// ---------- widget ----------

function addLabel(stack, text, size, color, bold = false) {
  const label = stack.addText(text)
  label.font = bold ? Font.heavySystemFont(size) : Font.mediumSystemFont(size)
  label.textColor = color
  label.lineLimit = 1
  label.minimumScaleFactor = 0.6
  return label
}

// A countdown that iOS keeps ticking on the widget without re-running the script
function addCountdown(stack, end, size, color) {
  const date = stack.addDate(end)
  date.applyTimerStyle()
  date.font = Font.boldSystemFont(size)
  date.textColor = color
  date.lineLimit = 1
  return date
}

function addSymbol(stack, name, size, color) {
  const symbol = SFSymbol.named(name)
  symbol.applyFont(Font.boldSystemFont(size))
  const image = stack.addImage(symbol.image)
  image.imageSize = new Size(size, size)
  image.tintColor = color
  return image
}

// A horizontal row whose content sits in the middle
function centeredRow(parent) {
  const row = parent.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  row.addSpacer()
  return row
}

function addBrand(parent, size) {
  const label = addLabel(parent, BRAND, size, COLORS.sub, true)
  label.textOpacity = 0.8
  return label
}

function progressBar(fraction, width, height, color) {
  const ctx = new DrawContext()
  ctx.size = new Size(width, height)
  ctx.opaque = false
  ctx.respectScreenScale = true
  const radius = height / 2
  const track = new Path()
  track.addRoundedRect(new Rect(0, 0, width, height), radius, radius)
  ctx.addPath(track)
  ctx.setFillColor(COLORS.muted)
  ctx.fillPath()
  if (fraction > 0) {
    const bar = new Path()
    bar.addRoundedRect(new Rect(0, 0, Math.max(width * Math.min(fraction, 1), height), height), radius, radius)
    ctx.addPath(bar)
    ctx.setFillColor(color)
    ctx.fillPath()
  }
  return ctx.getImage()
}

// Apple-Watch-style ring: a dim track plus an arc from 12 o'clock, clockwise
function ringImage(fraction, size, lineWidth, color) {
  const ctx = new DrawContext()
  ctx.size = new Size(size, size)
  ctx.opaque = false
  ctx.respectScreenScale = true
  const center = size / 2
  const radius = (size - lineWidth) / 2
  ctx.setStrokeColor(COLORS.muted)
  ctx.setLineWidth(lineWidth)
  ctx.strokeEllipse(new Rect(lineWidth / 2, lineWidth / 2, size - lineWidth, size - lineWidth))
  const f = Math.min(Math.max(fraction, 0), 1)
  if (f > 0) {
    // Path has no arc primitive, so the arc is a fine polyline
    const steps = Math.max(2, Math.ceil(120 * f))
    const point = (t) => {
      const angle = -Math.PI / 2 + 2 * Math.PI * f * t
      return new Point(center + radius * Math.cos(angle), center + radius * Math.sin(angle))
    }
    const arc = new Path()
    arc.addLines(Array.from({ length: steps + 1 }, (_, i) => point(i / steps)))
    ctx.addPath(arc)
    ctx.setStrokeColor(color)
    ctx.setLineWidth(lineWidth)
    ctx.strokePath()
    // Round the ends of the arc
    ctx.setFillColor(color)
    for (const p of [point(0), point(1)]) {
      ctx.fillEllipse(new Rect(p.x - lineWidth / 2, p.y - lineWidth / 2, lineWidth, lineWidth))
    }
  }
  return ctx.getImage()
}

// The flame inside today's progress ring, both in the color of the current level
function addFlameRing(parent, s, lv, size) {
  const ring = parent.addStack()
  ring.size = new Size(size, size)
  ring.backgroundImage = ringImage(s.progress, size, Math.round(size / 9), lv.color)
  ring.layoutHorizontally()
  ring.centerAlignContent()
  ring.addSpacer()
  addSymbol(ring, "flame.fill", Math.round(size * 0.42), s.complete ? lv.color : COLORS.muted)
  ring.addSpacer()
  return ring
}

// Days since 1970 in local time, so the quote changes at the user's midnight
function todaysQuote(now = new Date()) {
  const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000)
  return DAILY_QUOTES[day % DAILY_QUOTES.length]
}

function addQuote(stack, size) {
  const quote = addLabel(stack, todaysQuote(), size, COLORS.flame, true)
  quote.lineLimit = 2
  return quote
}

function statusText(s) {
  return s.complete ? "Done for today ✅" : `${plural(s.left, "task")} left`
}

function buildSmall(widget, data, s) {
  const lv = level(s.streak)
  widget.setPadding(10, 12, 12, 12)
  const brand = centeredRow(widget)
  addBrand(brand, 9)
  brand.addSpacer()
  widget.addSpacer(4)

  const ringRow = centeredRow(widget)
  addFlameRing(ringRow, s, lv, 54)
  ringRow.addSpacer()
  widget.addSpacer(3)

  const count = centeredRow(widget)
  addLabel(count, String(s.streak), 17, s.complete ? lv.color : COLORS.text, true)
  count.addSpacer(4)
  addLabel(count, "day streak", 11, COLORS.sub)
  count.addSpacer()

  widget.addSpacer()
  const status = centeredRow(widget)
  const end = timerEnd(data)
  if (end) {
    addSymbol(status, "timer", 13, lv.color)
    status.addSpacer(4)
    addCountdown(status, end, 15, lv.color)
  } else if (!s.started) {
    addQuote(status, 11).centerAlignText()
  } else {
    addLabel(status, statusText(s), 12, s.complete ? COLORS.done : COLORS.text, true)
  }
  status.addSpacer()
}

function buildMedium(widget, data, s, maxTasks) {
  const lv = level(s.streak)
  widget.setPadding(12, 14, 12, 16)
  const top = widget.addStack()
  top.layoutHorizontally()
  top.topAlignContent()

  // Left: the ring, the streak and the level
  const side = top.addStack()
  side.layoutVertically()
  side.size = new Size(86, 0)
  const ringRow = centeredRow(side)
  addFlameRing(ringRow, s, lv, 56)
  ringRow.addSpacer()
  side.addSpacer(3)
  const count = centeredRow(side)
  addLabel(count, String(s.streak), 16, s.complete ? lv.color : COLORS.text, true)
  count.addSpacer(3)
  addLabel(count, s.streak === 1 ? "day" : "days", 10, COLORS.sub)
  count.addSpacer()
  const title = centeredRow(side)
  addLabel(title, lv.title, 10, lv.color, true)
  title.addSpacer()

  top.addSpacer(12)

  // Right: the name and today's checklist
  const list = top.addStack()
  list.layoutVertically()
  list.spacing = 5
  addBrand(list, 10)
  const done = new Set(doneIds(data, s.key))
  for (const task of TASKS.slice(0, maxTasks)) {
    const isDone = done.has(task.id)
    const timed = Boolean(task.minutes) && !isDone
    const running = timed && isRunning(data, task.id)
    const line = list.addStack()
    line.layoutHorizontally()
    line.centerAlignContent()
    // Tapping a timed task's line starts or pauses its timer
    if (timed) line.url = timerURL(task.id)
    const icon = isDone ? "checkmark.circle.fill" : running ? "pause.circle.fill" : timed ? "play.circle.fill" : "circle"
    addSymbol(line, icon, 15, isDone ? COLORS.done : timed ? COLORS.flame : COLORS.muted)
    line.addSpacer(6)
    addLabel(line, `${task.emoji} ${task.title}`, 13, isDone ? COLORS.sub : COLORS.text)
    line.addSpacer()
    if (running) addCountdown(line, timerEnd(data), 12, COLORS.flame)
    else if (timed) addLabel(line, formatDuration(remainingSeconds(data, s.key, task)), 11, COLORS.flame)
  }
  if (TASKS.length > maxTasks) {
    addLabel(list, `and ${plural(TASKS.length - maxTasks, "more task")}`, 11, COLORS.sub)
  }
  if (!s.started) addQuote(list, 11)

  widget.addSpacer()

  // The last seven days, today on the right
  const week = widget.addStack()
  week.layoutHorizontally()
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const day = addDays(today, -i)
    const complete = isComplete(data, dayKey(day))
    const cell = week.addStack()
    cell.layoutVertically()
    cell.spacing = 2
    const color = complete ? COLORS.flame : i === 0 ? COLORS.text : COLORS.muted
    addSymbol(cell, complete ? "flame.fill" : "circle", 14, color).centerAlignImage()
    addLabel(cell, WEEKDAY_INITIALS[day.getDay()], 10, i === 0 ? COLORS.text : COLORS.sub).centerAlignText()
    if (i > 0) week.addSpacer()
  }
}

function buildAccessory(widget, data, s, family) {
  const end = timerEnd(data)
  if (family === "accessoryInline") {
    const status = end ? `⏱ until ${formatClock(end)}` : s.started ? statusText(s) : todaysQuote()
    widget.addText(`🔥 ${s.streak}  ${status}`)
    return
  }
  if (family === "accessoryCircular") {
    widget.addAccessoryWidgetBackground = true
    const flame = centeredRow(widget)
    addSymbol(flame, end ? "timer" : "flame.fill", 16, Color.white())
    flame.addSpacer()
    const number = centeredRow(widget)
    addLabel(number, String(s.streak), 18, Color.white(), true)
    number.addSpacer()
    return
  }
  // accessoryRectangular
  addLabel(widget, `🔥 ${s.streak}-day streak`, 14, Color.white(), true)
  if (end) {
    const status = widget.addStack()
    status.centerAlignContent()
    addLabel(status, "⏱ ", 12, Color.white())
    addCountdown(status, end, 12, Color.white())
  } else {
    addLabel(widget, s.started ? statusText(s) : todaysQuote(), 12, Color.white())
  }
  widget.addSpacer(4)
  const bar = widget.addImage(progressBar(s.done / GOAL, 140, 6, Color.white()))
  bar.imageSize = new Size(140, 6)
}

function createWidget(data, family) {
  const s = summary(data)
  const widget = new ListWidget()
  // Tapping the widget opens the checklist
  widget.url = URLScheme.forRunningScript()
  // Redraw after midnight (new day) and when a running timer ends (to tick the task)
  const midnight = addDays(startOfDay(new Date()), 1)
  const moments = [midnight.getTime() + 60 * 1000, Date.now() + 30 * 60 * 1000]
  const end = timerEnd(data)
  // While a timer runs, also redraw every 15 minutes so the ring keeps filling
  if (end) moments.push(end.getTime() + 5 * 1000, Date.now() + 15 * 60 * 1000)
  widget.refreshAfterDate = new Date(Math.min(...moments))

  if (family && family.startsWith("accessory")) {
    buildAccessory(widget, data, s, family)
    return widget
  }
  widget.backgroundColor = COLORS.bg
  if (family === "small") buildSmall(widget, data, s)
  else buildMedium(widget, data, s, family === "large" || family === "extraLarge" ? 8 : 3)
  return widget
}

// ---------- checklist (opens when the widget is tapped) ----------

function taskSubtitle(data, key, task, isDone) {
  if (!task.minutes) return undefined
  if (isDone) return "Done"
  if (isRunning(data, task.id)) return `⏱ Running · ends at ${formatClock(timerEnd(data))}`
  return `${formatDuration(remainingSeconds(data, key, task))} left of ${formatDuration(task.minutes * 60)}`
}

async function timedTaskMenu(data, key, task) {
  const isDone = doneIds(data, key).includes(task.id)
  const running = isRunning(data, task.id)
  const actions = []
  if (isDone) {
    actions.push(["↩️ Untick", () => toggleTask(data, key, task.id)])
  } else if (running) {
    actions.push(["⏸ Pause timer", () => pauseTimer(data)])
    actions.push(["✅ Done, tick it", () => { pauseTimer(data); markDone(data, key, task.id) }])
  } else {
    const resumed = bankedSeconds(data, key, task.id) > 0
    actions.push([resumed ? "▶️ Resume timer" : "▶️ Start timer", () => startTimer(data, task.id)])
    actions.push(["✅ Tick without timer", () => markDone(data, key, task.id)])
  }
  const alert = new Alert()
  alert.title = `${task.emoji} ${task.title}`
  alert.message = taskSubtitle(data, key, task, isDone)
  for (const [title] of actions) alert.addAction(title)
  alert.addCancelAction("Cancel")
  const choice = await alert.presentSheet()
  if (choice >= 0 && choice < actions.length) actions[choice][1]()
}

async function showChecklist(data) {
  const table = new UITable()
  table.showSeparators = true

  const render = () => {
    table.removeAllRows()
    const s = summary(data)
    const lv = level(s.streak)

    const header = new UITableRow()
    header.isHeader = true
    header.height = 90
    const subtitle = s.complete
      ? `Done for today. Great job, ${OWNER_NAME}! 🎉`
      : s.started ? `${OWNER_NAME}'s daily · ${plural(s.left, "task")} left` : todaysQuote()
    const title = header.addText(`🔥 ${s.streak}-day streak`, subtitle)
    title.titleFont = Font.heavySystemFont(22)
    title.subtitleFont = Font.mediumSystemFont(14)
    title.titleColor = lv.color
    if (!s.started) title.subtitleColor = COLORS.flame
    table.addRow(header)

    const levelRow = new UITableRow()
    const levelText = levelRow.addText(
      `🏅 ${lv.title}`,
      lv.next ? `${plural(lv.next.days - s.streak, "day")} to ${lv.next.title}` : "Top level reached 👑"
    )
    levelText.titleColor = lv.color
    levelText.titleFont = Font.boldSystemFont(15)
    levelText.subtitleFont = Font.systemFont(12)
    table.addRow(levelRow)

    const done = new Set(doneIds(data, s.key))
    for (const task of TASKS) {
      const isDone = done.has(task.id)
      const row = new UITableRow()
      row.height = 60
      row.dismissOnSelect = false
      const mark = isDone ? "✅" : !task.minutes ? "⬜️" : isRunning(data, task.id) ? "⏸" : "▶️"
      const markCell = row.addText(mark)
      markCell.centerAligned()
      markCell.widthWeight = 15
      const label = row.addText(`${task.emoji} ${task.title}`, taskSubtitle(data, s.key, task, isDone))
      label.widthWeight = 85
      label.titleFont = Font.mediumSystemFont(17)
      label.subtitleFont = Font.systemFont(12)
      row.onSelect = async () => {
        if (task.minutes) await timedTaskMenu(data, s.key, task)
        else toggleTask(data, s.key, task.id)
        // Save and re-plan right away: the user may leave without closing this screen
        await commit(data)
        render()
        table.reload()
      }
      table.addRow(row)
    }

    const hint = new UITableRow()
    const hintText = hint.addText("Tap a task to tick it. Timed tasks start with ▶️.")
    hintText.titleFont = Font.systemFont(12)
    hintText.titleColor = Color.gray()
    table.addRow(hint)

    const settingsRow = new UITableRow()
    settingsRow.height = 50
    settingsRow.dismissOnSelect = false
    const settingsText = settingsRow.addText("⚙️ Settings", "Tasks, timers, daily goal, reminders")
    settingsText.titleFont = Font.mediumSystemFont(16)
    settingsText.subtitleFont = Font.systemFont(12)
    settingsRow.onSelect = async () => {
      await showSettings(data)
      render()
      table.reload()
    }
    table.addRow(settingsRow)
  }

  render()
  await table.present(false)
}

// ---------- settings screen ----------

// The settings the app owns; the first edit copies the defaults in
function editableSettings(data) {
  if (!data.settings) {
    data.settings = {
      tasks: TASKS.map((t) => ({ ...t })),
      reminders: REMINDERS.map((r) => ({ ...r })),
      goal: null,
    }
  }
  return data.settings
}

// Action sheet; each action is [label, handler] or [label, handler, true] for a red one.
// Returns the handler's result, or false when cancelled.
async function menu(title, message, actions) {
  const alert = new Alert()
  alert.title = title
  if (message) alert.message = message
  for (const [label, , destructive] of actions) {
    if (destructive) alert.addDestructiveAction(label)
    else alert.addAction(label)
  }
  alert.addCancelAction("Cancel")
  const choice = await alert.presentSheet()
  return choice >= 0 && choice < actions.length ? actions[choice][1]() : false
}

// Text prompt; returns the trimmed values, or null when cancelled
async function ask(title, message, fields) {
  const alert = new Alert()
  alert.title = title
  if (message) alert.message = message
  for (const field of fields) {
    const input = alert.addTextField(field.placeholder, field.value || "")
    if (field.number && input && input.setNumberPadKeyboard) input.setNumberPadKeyboard()
  }
  alert.addAction("Save")
  alert.addCancelAction("Cancel")
  if ((await alert.presentAlert()) === -1) return null
  return fields.map((_, i) => alert.textFieldValue(i).trim())
}

async function notify(title, message) {
  const alert = new Alert()
  alert.title = title
  alert.message = message
  alert.addAction("OK")
  await alert.presentAlert()
}

// "" -> null (no timer), "45" -> 45, anything invalid -> undefined
function parseMinutes(text) {
  if (text === "") return null
  const minutes = Number(text)
  return Number.isInteger(minutes) && minutes > 0 && minutes <= 24 * 60 ? minutes : undefined
}

async function pickTime(hour, minute) {
  const picker = new DatePicker()
  const initial = new Date()
  initial.setHours(hour, minute, 0, 0)
  picker.initialDate = initial
  try {
    const picked = await picker.pickTime()
    return { hour: picked.getHours(), minute: picked.getMinutes() }
  } catch (e) {
    return null // cancelled
  }
}

async function addTask(data) {
  const values = await ask("New task", "Leave the timer empty for a simple tick task.", [
    { placeholder: "Title, e.g. Gym" },
    { placeholder: "Emoji", value: "✅" },
    { placeholder: "Timer in minutes (optional)", number: true },
  ])
  if (!values) return false
  const [title, emoji, minutesText] = values
  const minutes = parseMinutes(minutesText)
  if (!title) return notify("No title", "A task needs a title.").then(() => false)
  if (minutes === undefined) return notify("Invalid timer", "Use whole minutes, e.g. 45 or 120.").then(() => false)
  const task = { id: `task-${Date.now().toString(36)}`, title, emoji: emoji || "✅" }
  if (minutes) task.minutes = minutes
  editableSettings(data).tasks.push(task)
}

async function editTask(data, index) {
  const tasks = editableSettings(data).tasks
  const task = tasks[index]
  const actions = [
    ["✏️ Rename", async () => {
      const values = await ask("Rename task", null, [{ placeholder: "Title", value: task.title }])
      if (!values || !values[0]) return false
      task.title = values[0]
    }],
    ["😀 Change emoji", async () => {
      const values = await ask("Change emoji", null, [{ placeholder: "Emoji", value: task.emoji }])
      if (!values || !values[0]) return false
      task.emoji = values[0]
    }],
    [task.minutes ? "⏱ Change timer" : "⏱ Add timer", async () => {
      const values = await ask("Timer", "Minutes of work that tick this task.", [
        { placeholder: "Minutes, e.g. 120", value: task.minutes ? String(task.minutes) : "", number: true },
      ])
      if (!values) return false
      const minutes = parseMinutes(values[0])
      if (!minutes) return notify("Invalid timer", "Use whole minutes, e.g. 45 or 120.").then(() => false)
      task.minutes = minutes
    }],
  ]
  if (task.minutes) {
    actions.push(["🚫 Remove timer", () => {
      delete task.minutes
      if (isRunning(data, task.id)) data.timer = null
    }])
  }
  if (index > 0) {
    actions.push(["⬆️ Move up", () => {
      tasks.splice(index - 1, 0, tasks.splice(index, 1)[0])
    }])
  }
  actions.push(["🗑 Delete task", async () => {
    if (tasks.length === 1) return notify("Can't delete", "Keep at least one task.").then(() => false)
    tasks.splice(index, 1)
    if (isRunning(data, task.id)) data.timer = null
    const goal = data.settings.goal
    if (goal && goal > tasks.length) data.settings.goal = null
  }, true])
  const timer = task.minutes ? `Timer: ${formatDuration(task.minutes * 60)}` : "No timer"
  return menu(`${task.emoji} ${task.title}`, timer, actions)
}

async function chooseGoal(data) {
  const actions = TASKS.map((_, i) => {
    const n = i + 1
    const label = n === TASKS.length ? `All ${plural(n, "task")}` : `${n} of ${TASKS.length} tasks`
    return [label, () => {
      editableSettings(data).goal = n === TASKS.length ? null : n
    }]
  })
  return menu("Daily goal", "How many tasks keep the streak alive?", actions)
}

async function addReminder(data) {
  const time = await pickTime(12, 0)
  if (!time) return false
  editableSettings(data).reminders.push(time)
}

async function editReminder(data, reminder) {
  const reminders = editableSettings(data).reminders
  // REMINDERS is a sorted copy, so find the stored one by its time
  const index = reminders.findIndex((r) => r.hour === reminder.hour && r.minute === reminder.minute)
  return menu(`⏰ ${pad(reminder.hour)}:${pad(reminder.minute)}`, null, [
    ["🕐 Change time", async () => {
      const time = await pickTime(reminder.hour, reminder.minute)
      if (!time) return false
      reminders[index] = time
    }],
    ["🗑 Delete reminder", () => {
      reminders.splice(index, 1)
    }, true],
  ])
}

async function showSettings(data) {
  const table = new UITable()
  table.showSeparators = true

  const sectionHeader = (title) => {
    const row = new UITableRow()
    row.isHeader = true
    row.addText(title).titleFont = Font.boldSystemFont(13)
    table.addRow(row)
  }

  const actionRow = (title, subtitle, handler) => {
    const row = new UITableRow()
    row.height = subtitle ? 56 : 46
    row.dismissOnSelect = false
    const cell = row.addText(title, subtitle)
    cell.titleFont = Font.mediumSystemFont(16)
    cell.subtitleFont = Font.systemFont(12)
    row.onSelect = async () => {
      if ((await handler()) !== false) {
        applySettings(data)
        await commit(data)
      }
      render()
      table.reload()
    }
    table.addRow(row)
  }

  const render = () => {
    table.removeAllRows()

    sectionHeader("TASKS")
    TASKS.forEach((task, index) => {
      const timer = task.minutes ? `⏱ ${formatDuration(task.minutes * 60)} timer` : "No timer"
      actionRow(`${task.emoji} ${task.title}`, timer, () => editTask(data, index))
    })
    actionRow("➕ Add task", null, () => addTask(data))

    sectionHeader("DAILY GOAL")
    const goal = GOAL === TASKS.length ? `All ${plural(GOAL, "task")}` : `${GOAL} of ${TASKS.length} tasks`
    actionRow(`🎯 ${goal}`, "Needed each day to keep the streak", () => chooseGoal(data))

    sectionHeader("REMINDERS")
    REMINDERS.forEach((reminder, index) => {
      const note = index === REMINDERS.length - 1 ? "Streak-at-risk warning" : null
      actionRow(`⏰ ${pad(reminder.hour)}:${pad(reminder.minute)}`, note, () => editReminder(data, reminder))
    })
    actionRow("➕ Add reminder", null, () => addReminder(data))

    sectionHeader("OTHER")
    actionRow("↩️ Reset to defaults", "Tasks and reminders written in the script", () =>
      menu("Reset settings?", "Your streak and history stay.", [
        ["Reset", () => { data.settings = null }, true],
      ]))
  }

  render()
  await table.present(false)
}

// ---------- reminders ----------

function reminderBody(today, isLast) {
  if (today && !today.started && !isLast) return todaysQuote()
  const left = plural(today ? today.left : GOAL, "task")
  if (isLast) {
    return today && today.streak > 0
      ? `${left} left. Finish them or your ${today.streak}-day streak resets.`
      : `${left} left. Wrap them up before bed.`
  }
  return today && today.done > 0
    ? `${today.done} done, ${left} to go.`
    : `You have ${left} today. Let's go!`
}

async function scheduleReminders(data) {
  const pending = await Notification.allPending()
  const ours = pending.map((n) => n.identifier).filter((id) => id && id.startsWith(NOTIFICATION_PREFIX))
  if (ours.length) await Notification.removePending(ours)

  const now = new Date()
  const today = summary(data, now)

  const end = timerEnd(data)
  if (end && end > now) {
    const task = taskById(data.timer.taskId)
    const n = new Notification()
    n.identifier = `${NOTIFICATION_PREFIX}timer`
    n.threadIdentifier = "habit-widget"
    n.openURL = URLScheme.forRunningScript()
    n.sound = "default"
    n.title = `✅ ${task.title}: time's up!`
    n.body = `Nice work, ${OWNER_NAME}! It's ticked and today's streak moved forward 🔥`
    n.setTriggerDate(end)
    n.schedule()
  }

  // iOS keeps at most 64 pending notifications; every run re-plans the coming days
  const days = Math.max(1, Math.min(7, Math.floor(60 / Math.max(REMINDERS.length, 1))))
  for (let offset = 0; offset < days; offset++) {
    if (offset === 0 && today.complete) continue
    const day = addDays(startOfDay(now), offset)
    REMINDERS.forEach((r, index) => {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), r.hour, r.minute)
      if (at <= now) return
      const isLast = index === REMINDERS.length - 1
      const n = new Notification()
      n.identifier = `${NOTIFICATION_PREFIX}${dayKey(day)}-${index}`
      n.threadIdentifier = "habit-widget"
      n.openURL = URLScheme.forRunningScript()
      n.sound = "default"
      n.title = isLast
        ? `🔥 ${OWNER_NAME}, your streak is at risk!`
        : index === 0 ? `☀️ New day, ${OWNER_NAME}!` : "⏰ Don't forget"
      n.body = reminderBody(offset === 0 ? today : null, isLast)
      n.setTriggerDate(at)
      n.schedule()
    })
  }
}

function tryLevelUp(data, notify) {
  try {
    checkLevelUp(data, notify)
  } catch (e) {
    console.log(`could not send level-up notification: ${e}`)
  }
}

// Bring the derived state up to date; returns true if anything changed.
// With notify = false it's a dry run that sends no level-up notification.
function refresh(data, notify = true) {
  const before = JSON.stringify(data)
  const timerDay = data.timer && data.timer.day
  if (settleTimer(data) && timerDay) recordDay(data, timerDay)
  recordDay(data, dayKey(new Date()))
  tryLevelUp(data, notify)
  return JSON.stringify(data) !== before
}

async function commit(data) {
  refresh(data)
  saveData(data)
  try {
    await scheduleReminders(data)
  } catch (e) {
    console.log(`could not schedule reminders: ${e}`)
  }
}

// ---------- run ----------

let data = await loadData()
if (config.runsInWidget) {
  // Dry run on a copy: only touch the file when something actually changes
  if (refresh(JSON.parse(JSON.stringify(data)), false)) {
    // Re-read right before writing, so a tick the app saved a moment ago isn't overwritten
    data = await loadData()
    refresh(data)
    saveData(data)
  }
  Script.setWidget(createWidget(data, config.widgetFamily))
  try {
    await scheduleReminders(data)
  } catch (e) {
    console.log(`could not schedule reminders: ${e}`)
  }
} else {
  // Opened from a timed task's line on the widget: start or pause that timer
  const params = args.queryParameters || {}
  const task = params.action === "timer" ? taskById(params.task) : null
  if (task && task.minutes && !doneIds(data, dayKey(new Date())).includes(task.id)) {
    if (isRunning(data, task.id)) pauseTimer(data)
    else startTimer(data, task.id)
  }
  await commit(data)
  await showChecklist(data)
  await commit(data)
}
Script.complete()
