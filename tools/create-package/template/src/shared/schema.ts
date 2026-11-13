// fallow-ignore-file unused-export unused-type -- A new package's public contract has no consumer until the app imports it.
import {Schema, pipe} from 'effect'

export type ItemId = typeof ItemId.Type
export const ItemId = pipe(Schema.NonEmptyString, Schema.brand('TemplatePackageItemId'))
