import ExpoMetro from 'expo/metro-config'

import {iphoneMetro} from '@deslop/components/metro'

export default iphoneMetro({...ExpoMetro.getDefaultConfig(import.meta.dirname)})
