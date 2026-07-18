# Kryptos Sandbox UI

A dependency-free cryptanalytic workspace. Run `python3 serve.py`, then open `http://localhost:8000` in a modern desktop browser. If that port is occupied, choose another with `python3 serve.py --port 8765`.

The published version is available at <https://alexchaloner.github.io/kryptos-sandbox/>.

## Publishing

This repository is a self-contained static GitHub Pages project site. In the repository's GitHub settings, choose **Pages**, select **Deploy from a branch**, and publish the root of the `main` branch. Every subsequent push to `main` will update the site.

The development server disables caching and enables automatic source-file reloads. Those development-only reload checks are disabled on the published site.

## Included interactions

- Move grids by dragging their headers and resize them from the lower-right corner.
- Keep a dragged grid attached to the pointer while the canvas scrolls, place every newly created grid inside the current canvas viewport, and retain a scrollable margin beyond the outermost grids.
- Double-click empty canvas space to create a new grid at that position.
- Resizing a card horizontally automatically reflows its letters and updates its row/column dimensions while preserving the full text.
- Drag across cells for a continuous row-major selection; hold `Ctrl`/`Cmd` to add a rectangular region, or Ctrl/Cmd-click to add individual cells.
- Type with cells selected to overwrite them one-by-one from left to right, top to bottom.
- Copy a whole grid as row-preserving plain text, copy a cell selection in its traversal order, and paste directly into a selected grid or cell range.
- Paste plain text onto an unselected board to create a content-fitted grid, preserving rectangular line widths or choosing a balanced layout automatically.
- Rotate, transpose, reflect left-to-right or top-to-bottom, duplicate, delete, paste into, and copy from grids.
- Colour selected letters amber, blue, coral, or green, clear colours independently, and preserve annotations through saves, edits, duplication, and matrix transforms.
- Preview Vigenère results directly on intersecting cells while dragging, then materialize the physically aligned letter pairs as a compact, blank-free result linked to both source grids.
- Switch between the Kryptos keyed alphabet, A–Z, or a custom alphabet.
- Analyse a selection or full grid using frequency similarity, index of coincidence, bigrams, and simulated uniform-random null likelihoods.
- Scan candidate Vigenère key lengths using average vertical-column IC with exact uniform-null standard errors, sample-size-adjusted z-scores, approximate p-values, and 95% null bands; inspect each column, infer frequency-based key letters under the active alphabet, and preview candidate decryptions.
- Automatically scan every coprime modular transposition stride when the active grid or cell selection changes, using English 2/3/4-gram evidence or the maximum adjusted column-IC score found over a second scan of possible hidden Vigenère key lengths.
- Materialize the winning layered route as an intermediate pre-Vigenère grid whose column count equals the detected key length.
- Automatically persist workspace folders, grids, preferences, and undo history in browser local storage.
- Undo and redo up to 100 document changes using the toolbar or standard keyboard shortcuts.
- Import the complete courtyard-oriented Kryptos left ciphertext plate or right keyed-Vigenère tableau with their irregular rows preserved.
- Import K1–K4, either known K4 crib independently, or a matching 7×14 positional mask with visible `?` unknown slots from the left sidebar.
- Start from populated K1, K2, and K3 solution workspaces containing aligned ciphertext and known plaintext grids.
- Import the Kryptos keyed alphabet or a random cleaned passage of roughly 100 letters from a public-domain book.
- Repeat a selected grid/cell sequence N times from the toolbar's inline Clone extend slider.
- Create independent persistent workspaces, organize them in collapsible folders, and drag workspaces between folders.
- Right-click cells, grids, the workspace canvas, folders, or workspace entries for contextual actions.
- Select operand A followed by operand B to create live linked addition or subtraction results; positional overlays use matching A/B color labels.
- Create experimental synchronized views with independent column counts; edits and selections mirror through their canonical source until a view is transformed or deleted.
- Sparse rotation and transposition preserve absent cells without inserting padding characters.

The app has no build step. `app.js` contains browser orchestration, while `modules/` separates cipher operations, statistical analysis, sparse matrix transforms, context menus, and shared utilities.
When served over localhost, it checks source files for changes and reloads the page automatically during development while preserving workspace and undo history.
