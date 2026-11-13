# @deslop/template-package

Shared contracts live in `src/shared/`, exported through `@deslop/template-package/shared/<name>`. Replace the starter's `ItemId` with the first domain contract and remove its unused-export suppression when an app imports it.

Add server, client, web or mobile subpaths when the package needs them; shared code must not import those sides. Keep the public contract here.
