# Teleprompter

A small teleprompter that runs in a browser. It needs no account, install, or internet connection.

Funnel Sans is bundled for offline use under the [SIL Open Font License](fonts/OFL.txt).

## Use it

1. Open `index.html` in your browser.
2. Paste a formatted script. The reading view keeps your line breaks and blank lines. Use `**bold**` or `*italic*` for visual emphasis; the reading view hides those marks. A backslash at the end of a line is also hidden, while the line break stays.
3. Adjust the scroll speed, text size, and line width if needed. The starting values are 25 px/s, 44 px, and 580 px. The time shown near speed estimates how long the text will take to scroll; your speaking time may differ.
4. Open the reading view and press **Space** when you are ready to speak.
5. Press **Space** to pause or resume, **↑ / ↓** to change speed by 5 px/s, or **R** to restart. You can also use the controls at the bottom, which let you change speed, text size, line width, and dimming while you read. The **Full screen** button hides browser tabs and the address bar.

The browser **Back** button returns from reading to editing. **Forward** reopens the reading view.

The small timer above the reading line counts up while Play is active, including when the script fits on screen or has reached the bottom. Pausing stops it; Restart resets it to 00:00.

The three lines at the reading line stay bright. Text you have already read fades the most; text coming up stays half bright, so you can read ahead. To show all text at full brightness, turn off **Dim lines** in the settings or in the reading view controls. The app also turns dimming off when your system asks for more contrast.

The script and settings stay on this page only. Refreshing or leaving the page starts with a blank script and the default settings. Keep your own copy of the script.

## Recording with OBS (optional)

If you record only your camera, add your camera as a **Video Capture Device** source in OBS. If you also record your screen on a recent Mac, use **macOS Screen Capture** and select the app or window you want to show. Capturing the whole display will include the teleprompter. See the [OBS sources guide](https://obsproject.com/kb/sources-guide) for other systems and macOS versions.

## Check the code

Run `node --test app.test.js` from this folder. The app itself needs no Node install to run.
