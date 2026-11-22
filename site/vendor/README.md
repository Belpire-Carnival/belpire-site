# Vendored libraries

The site has no npm dependencies or bundler, so the few browser libraries it needs are copied here
unchanged from their published npm packages. Each folder is named with its exact version; to upgrade, add a new folder and point the imports at
it. Like every script they revalidate on each load (a cheap 304 while unchanged).

| Folder | Package | Licence | Used by |
| --- | --- | --- | --- |
| `three-0.170.0/` | `three@0.170.0` (`build/three.module.min.js`) | MIT (`LICENSE.txt`) | The Midway's 3D booth stage (`site/midway/`) |
| `three-0.170.0/loaders/GLTFLoader.js`, `utils/BufferGeometryUtils.js` | `three@0.170.0` (`examples/jsm/…`) | MIT | Loading the Midway's Meshy props |

The two `examples/jsm` files are the only edited copies: their `from 'three'` import is changed to
`from '../three.module.min.js'`, because a bare `three` import needs an inline import map, which the
site's Content Security Policy does not allow. Nothing else in them is changed (a test checks this).
