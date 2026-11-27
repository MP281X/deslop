import ExpoMetro from 'expo/metro-config'

import {iphoneMetro} from '@deslop/design/metro'

export default iphoneMetro({...ExpoMetro.getDefaultConfig(import.meta.dirname)})
