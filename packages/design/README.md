# @deslop/design

`@deslop/design/web` and `@deslop/design/native` render the same Effect UI list, detail and sheet model with the HTML and Fabric hosts. An app supplies its rows, detail and sheet copy. Its route owns the selected row: pass its ID and the headless parts that handle row taps and back. The Fabric host requires react-native-screens and react-native-safe-area-context to be linked into the iOS target; the JS does not import either package's React components.

The gallery uses the same fixture on both hosts. Run `vp run --filter @deslop/design preview` for the web gallery. For the iPhone Duo use `gallery/native/main.ts` as the entry of an Expo simulator build configured with `NativeMetro.withEffectUi` from `@effect/ui-native/node`.
