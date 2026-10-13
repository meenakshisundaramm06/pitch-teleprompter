# Teleprompter

A teleprompter that runs in your browser. Paste a script, press Space, and read as the text scrolls. No account, no install, and nothing leaves your computer.

**[Open it now →](https://meenakshisundaramm06.github.io/pitch-teleprompter/)**

Use it for a pitch, a talk, a video or a recorded demo.

## Use it

1. Open the link above.
2. Paste your script.
3. Set the speed, text size and line width, or keep the defaults (25 px/s, 44 px, 580 px).
4. Click **Open reading view**.
5. Press **Space** when you are ready to speak.

### Controls

| Key | Action |
| --- | --- |
| `Space` | Play or pause |
| `↑` `↓` | Change speed by 5 px/s |
| `R` | Restart from the top |

The buttons at the bottom of the reading view change speed, text size, line width and dimming while you read. **Full screen** hides the browser's tabs and address bar. **Edit script** (or the browser's Back button) returns you to the editor.

### Format your script

- Put each line where you want a pause or a breath. The reading view keeps your line breaks and blank lines.
- Wrap words in `**double stars**` for bold or `*single stars*` for italic. The reading view shows the style and hides the marks.
- End a line with a backslash (`\`) to keep a line break without showing the backslash.

### Read ahead

The three lines at the reading line stay bright. Lines you have read fade the most, and lines to come stay half bright, so you can see what is next. Turn off **Dim lines** to show all text at full brightness. The page also turns dimming off if your system asks for more contrast.

### Know the time

A small timer above the reading line counts up while the script plays. Pause stops it and Restart resets it to 00:00. The time shown near the speed setting is an estimate of how long the text takes to scroll. Your speaking time may differ.

## Things to know

- **It does not save your script.** Refresh or leave the page and you start with a blank script and the default settings. Keep your own copy.
- **It works offline.** Download the files, then open `index.html`. The font is bundled, so nothing loads from the internet.
- **It makes no network requests.** The page has no analytics and no tracking.

## Record with it (optional)

To record only your camera, add the camera as a **Video Capture Device** in [OBS](https://obsproject.com). If you also record your screen on a recent Mac, use **macOS Screen Capture** and pick the window you want to show. Capturing the whole display would include the teleprompter. See the [OBS sources guide](https://obsproject.com/kb/sources-guide) for other systems.

## Run or change it yourself

There is no build step. The whole app is three files: `index.html`, `app.js` and `styles.css`, plus the font in `fonts/`.

```bash
git clone https://github.com/meenakshisundaramm06/pitch-teleprompter.git
cd pitch-teleprompter
open index.html          # on macOS; or double-click the file
```

Run the tests with a recent version of Node (they use Node's built-in test runner):

```bash
node --test app.test.js
```

Every push to `main` runs the tests and then publishes the site to GitHub Pages.

## License

The code is [MIT](LICENSE). The font, Funnel Sans, is bundled under the [SIL Open Font License](fonts/OFL.txt).
