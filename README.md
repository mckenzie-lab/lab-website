# McKenzie Lab website

Static website for the McKenzie Lab in Oregon State University's Department of
Botany and Plant Pathology.

## Preview locally

No build step is required. From the repository root, run:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Publish

Pushing to the `main` branch runs the included GitHub Pages workflow. In the
repository's **Settings → Pages**, set the source to **GitHub Actions** the first
time the site is published.

## Editing

- Main page: `index.html`
- People page: `people/index.html`
- Shared styles: `styles.css`
- Blog index: `blog/index.html`
- First post: `blog/introducing-the-mckenzie-lab/index.html`
- Photographs: `assets/images/`
- Lab mark: `assets/images/monarda-brevis-cartoon-crop.svg`
- Reusable horizontal logo: `brand/mckenzie-lab-logo.svg`

The site uses `patrick.mckenzie@oregonstate.edu` as its contact address.

### People photos and bios

The undergraduate and Friends of the lab cards are in `people/index.html`.
To add a bio, insert `<p class="member-bio">Your text here.</p>` after the
person's role; each undergraduate card includes a commented example.

To replace a placeholder, add the portrait to `assets/images/`, update that
card's image `src`, `alt`, `width`, and `height`, and add the new image path to
the asset list in `.github/workflows/pages.yml` so GitHub Pages includes it.
Portraits are displayed as square crops.
