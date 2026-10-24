# REQ-EDIT-003: Images in the live preview

> Status: **Accepted**

## Summary

The live preview ([REQ-EDIT-001](editor.md)) shows the images that a Markdown
file embeds, written either as Markdown (`![alt](path)`) or as HTML (`<img>`,
`<picture>`, allowed by [REQ-EDIT-002](preview-html.md)):

- **repository images** are read from the user's working copy, as they are on
  disk. A path is resolved from the Markdown file's folder; a path that
  starts with `/` is resolved from the repository root, as on GitHub;
- the web client loads them through the API with the user's **auth token**,
  and shows them through `blob:` URLs, because an `<img>` tag cannot send the
  token;
- **remote images** (`https:` addresses on other hosts) are not loaded until
  the user asks: they are shown as placeholders, with **Show remote images**
  for the open file;
- an image that cannot be shown is replaced by a **placeholder** with its alt
  text and the reason.

PNG, JPEG, GIF, WebP, AVIF and SVG images are shown.

## Context

- The API authenticates with a bearer token in a header (LG-40, A-7.11). A
  browser loads `<img src>` without it, so repository images cannot be
  pointed at the API directly. Fetching them in the web client and showing
  them through `blob:` URLs needs no second credential and puts no token in
  a URL. The Content Security Policy already allows `blob:` images (NF-11.1).
- Documentation and READMEs are written for GitHub, where a path that starts
  with `/` means the repository root. Blog engines map such paths to their
  own folders (for example Hexo's `source/`); that mapping comes later.
- A remote image tells its host the user's IP address and when they read the
  file, and can track them. It is therefore loaded only when the user asks,
  for one file at a time. Loading remote images needs `https:` in the
  Content Security Policy's `img-src`; the web client never puts a remote
  address into the page before the user asks, so this only matters if the
  sanitising steps were bypassed (see [Security](#security)).
- An SVG shown through `<img>` cannot run script or load anything, and the
  backend serves repository files sandboxed (NF-11.3). Diagrams and logos in
  documentation are often SVG.
- A preview may hold hundreds of images. Loading only what is about to be
  seen, a few at a time, keeps the preview fast and within the API's rate
  limits (NF-11.4).
- The incremental preview keeps blocks that did not change (A-8.12), so
  typing does not reload images.

## Terms

**Repository image**
: An image embedded in a Markdown file whose address is a path inside the
same repository.

**Remote image**
: An image embedded with an `https:` address (or a protocol-relative one,
SH-16) on any host.

**Image placeholder**
: What the preview shows in place of an image that is not shown: a box with
the image's alt text, if any, and the reason.

**Image endpoint**
: The API endpoint that returns a repository image's bytes, so that the web
client can show it.

## Requirements

### Which addresses are repository images

- **IM-1** An image address is a **repository image** when it is a path
  with no scheme and no host. Every other address that survives sanitising
  (SH-15) is a **remote image** if it is `https:` or protocol-relative, and
  is not shown otherwise (IM-17).
- **IM-2** A relative path is resolved from the folder of the Markdown file
  that embeds it: `img/a.png`, `./img/a.png` and `../shared/b.png` work as in
  a browser. A path that starts with `/` is resolved from the repository
  root: `/images/cover.png` means `images/cover.png`. _(Like GitHub.)_
- **IM-3** Percent-encoded characters are decoded (`my%20photo.png` is
  `my photo.png`), and a query string or a fragment is ignored. Paths are
  case-sensitive, as on disk.
- **IM-4** A path that climbs above the repository root, or that leads into
  `.git` or through a symbolic link, is not resolved: the image gets the
  placeholder "Can't show this image". The backend checks every path with
  the rules of A-7.6 and does not trust the web client's resolution.
- **IM-5** The same rules apply to `src` on `<img>` and to every candidate in
  `srcset` on `<source>` (SH-11).

### Loading repository images

- **IM-6** The web client loads a repository image from the image endpoint
  with the auth token, like every other API request, and shows it through a
  `blob:` URL. No token or other secret ever appears in an image's address.
- **IM-7** The image endpoint:
  - serves files from the user's own working copy, as they are on disk,
    including files that are not committed and files ignored by
    `.gitignore`;
  - serves only image files of the formats in IM-9, of up to **10 MB**;
    _(My call. In the MVP it serves nothing else; other files are served
    when uploads and downloads are added.)_
  - sends the file with the headers of NF-11.3 and a content type taken from
    the file's extension, never guessed from its content;
  - returns a validator (for example an `ETag`), so that the web client can
    check cheaply whether a cached image changed.
- **IM-8** Images are loaded only when they are near the visible part of the
  preview, and at most **4** at a time per tab. _(My call.)_ An image that
  scrolls away before it loads is not loaded.
- **IM-9** These formats are shown: PNG, JPEG, GIF (animated too), WebP, AVIF
  and SVG. Files with other extensions, such as `.bmp`, `.tiff` or `.heic`,
  get the placeholder "This image format isn't supported".
- **IM-10** Each tab keeps the images it has loaded while the repository
  screen is open, so that switching between files or between the Edit and
  Preview tabs does not load them again. A cached image is checked against
  the server (IM-7) when the open file is opened again, and when the image
  file changes on disk (FB-41). `blob:` URLs that the preview no longer uses
  are released, so that memory does not grow without limit. _(My call: the
  cache size is left to the builder.)_
- **IM-11** The width and height written in the file (SH-11) are kept. An
  image is never wider than the preview; it keeps its proportions when it is
  scaled down. Before an image loads, the space it will take is reserved when
  its size is known, so that the preview does not jump.

### `<picture>`

- **IM-12** For a `<picture>`, the web client picks the image itself, as a
  browser would: the first `<source>` whose `media` matches and whose `type`
  the browser supports, otherwise the `<img>`. Only the picked image is
  loaded. When the colour scheme or the window size changes the result, the
  newly picked image is loaded. _(My call: needed because the browser cannot
  pick between `blob:` URLs it has not been given yet. Within `srcset`, the
  candidate for the screen's pixel density is picked.)_

### Remote images

- **IM-13** Remote images are not loaded when the file is opened. Each one is
  shown as a placeholder with its alt text and its host, for example "Remote
  image from img.shields.io". The web client never puts a remote address into
  the page until the user asks, so the browser never contacts the host.
- **IM-14** When the open file has remote images, the preview shows one
  **Show remote images** button above the first of them, with the note
  "Loading them lets these sites see your IP address." _(My call: one
  button per file, not per image.)_
- **IM-15** **Show remote images** loads every remote image of the open file,
  including ones added while the file stays open, with no referrer. The
  choice lasts until the file is closed; it is not remembered. _(My call.)_
- **IM-16** A remote image that fails to load gets the placeholder "Remote
  image couldn't be loaded", with its host.
- **IM-17** `http:` images are never loaded, even after **Show remote
  images**: they get the placeholder "Insecure image (http) isn't shown".
  _(Browsers block or upgrade them on an HTTPS page anyway.)_

### Placeholders

- **IM-18** An image that is not shown gets an image placeholder with its
  alt text and one of these reasons:

  | Case                                                   | Reason shown                                  |
  |--------------------------------------------------------|-----------------------------------------------|
  | The file does not exist                                | "Image not found: _&lt;path&gt;_"             |
  | Larger than 10 MB                                      | "This image is too large to preview"          |
  | Unsupported format (IM-9)                              | "This image format isn't supported"           |
  | Outside the repository, in `.git` or a symbolic link   | "Can't show this image"                       |
  | Could not be loaded (network, server error, bad data)  | "This image couldn't be loaded"               |
  | Remote, not yet shown (IM-13)                          | "Remote image from _&lt;host&gt;_"            |
  | Remote, failed (IM-16)                                 | "Remote image couldn't be loaded"             |
  | `http:` (IM-17)                                        | "Insecure image (http) isn't shown"           |

- **IM-19** A placeholder keeps the image's link, if the image is inside one
  (`[![alt](img.png)](https://…)`). An image that could not be loaded is
  tried again when its block of the preview is rendered again or the file is
  opened again. _(My call.)_
- **IM-20** While an image loads, its space shows a quiet loading state.

### Accessibility

- **IM-21** Every image keeps its alt text. A placeholder is exposed to
  screen readers as an image whose name is the alt text followed by the
  reason. **Show remote images** can be reached with the keyboard.
- **IM-22** Placeholders and the loading state follow NF-13, including
  `prefers-reduced-motion` for any loading animation.

### Security

- **IM-23** The Content Security Policy's `img-src` becomes
  `'self' blob: data: https:` (NF-11.1), so that remote images can be loaded
  after **Show remote images**. Nothing else in the policy changes.
- **IM-24** The web client sets an image's address only through the
  preview's image loader: repository images become `blob:` URLs, remote
  images keep their address only after **Show remote images**, and every
  other address is removed before the preview's HTML reaches the page. An
  address written in the file therefore never loads anything on its own,
  even with `https:` in `img-src`. _(My call: the loader replaces image
  addresses before DOMPurify's output is written to the page, D-7.6.)_
- **IM-25** A user can load images only from their own repositories. The
  image endpoint refuses another user's repository as if it did not exist.
- **IM-26** SVG images are shown only through `<img>` (never inline, SH-7),
  so they cannot run script or load other resources.

## Acceptance criteria

1. In `docs/guide.md`, `![Diagram](img/flow.png)` shows
   `docs/img/flow.png`, `![](../logo.svg)` shows the root's `logo.svg`, and
   `![](/images/cover.png)` shows `images/cover.png` at the root.
2. `<img src="img/flow.png" width="200">` in the same file shows the same
   image 200 px wide.
3. An image that was added to the working copy but not committed is shown.
4. In the browser's network log, repository images are requested from the
   API with the `Authorization` header; the page shows them through `blob:`
   URLs, and no image address contains a token.
5. `![](my%20photo.png)` shows `my photo.png`. `![](img.png?v=2)` shows
   `img.png`.
6. `![](../../../../etc/passwd)`, `![](.git/config)` and an image path through
   a symbolic link show "Can't show this image", and the image endpoint
   refuses them.
7. A missing image shows "Image not found: img/missing.png" with its alt
   text. A 12 MB PNG shows "This image is too large to preview". A `.tiff`
   shows "This image format isn't supported".
8. A file with 200 images loads only those near the visible part, at most 4
   at a time. Typing elsewhere in the file reloads none of them. Switching
   to another file and back shows them without loading them again.
9. Replacing an image file on disk (for example by a pull) shows the new
   image in the open preview without a reload.
10. `<picture>` with a dark-mode `<source>` shows the dark image in the dark
    colour scheme and the light one in the light scheme, and switches when
    the scheme changes. Only the shown image is requested.
11. A file with a remote badge shows "Remote image from img.shields.io", and
    the browser makes no request to that host. **Show remote images** loads
    it with no referrer; reopening the file shows the placeholder again.
12. `![](http://example.com/a.png)` shows "Insecure image (http) isn't shown"
    even after **Show remote images**.
13. An SVG with an embedded `<script>` is shown as an image and runs nothing.
14. A linked image whose file is missing keeps its link around the
    placeholder.
15. A screen reader reads a placeholder as its alt text and the reason.
16. A request to the image endpoint for another user's repository gets the
    same response as for a repository that does not exist.

## Out of scope

- Mapping `/` paths to a blog engine's folder (for example Hexo's
  `source/`), per repository.
- Loading remote images through an image proxy on the backend, and
  remembering **Show remote images** per repository.
- Viewing images outside the preview, for example by selecting them in the
  file tree (FB-21), and zooming or opening an image full size.
- Uploading images (later, with uploads) and pasting or dropping images into
  the editor.
- `<video>`, `<audio>` and other media (SH-7).
- Image formats other than those in IM-9.

## Open questions

None at the moment.
