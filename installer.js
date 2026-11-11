const files = await DocumentPicker.open()
const code = FileManager.local().readString(files[0])
let fm
try { fm = FileManager.iCloud(); fm.documentsDirectory() } catch (e) { fm = FileManager.local() }
fm.writeString(fm.joinPath(fm.documentsDirectory(), "Hooman Streak.js"), code)
const done = new Alert()
done.title = "Installed ✅"
done.message = "Hooman Streak is ready. You can delete this installer."
await done.presentAlert()
