import * as fs from 'fs'
import * as path from 'path'
import recast from 'recast'
import Map from 'ts-map'
import buildParser from '../babel-parser'
import cacher from './cacher'
import resolveImmediatelyExported from './resolveImmediatelyExported'
import { ImportedVariableSet } from './resolveRequired'

/**
 * Resolves specified variables to their actual files
 * Useful when using intermeriary files like this
 *
 * ```js
 * export mixin from "path/to/mixin"
 * ```
 *
 * @param pathResolver
 * @param varToFilePath
 */
export default function adaptExportsToIEV(
	pathResolver: (path: string, originalDirNameOverride?: string) => string,
	varToFilePath: ImportedVariableSet
) {
	// First, create a map from filepath to localName and exportedName
	// key: filepath, content: {key: localName, content: exportedName}
	const filePathToVars = new Map<string, Map<string, string>>()
	Object.keys(varToFilePath).forEach(k => {
		const exportedVariable = varToFilePath[k]
		if (exportedVariable.filePath.length !== 1) {
			return
		}
		const filePath = exportedVariable.filePath[0]
		const exportToLocalMap = filePathToVars.get(filePath) || new Map<string, string>()
		exportToLocalMap.set(k, exportedVariable.exportName)
		filePathToVars.set(filePath, exportToLocalMap)
	})

	// then roll though this map and replace varToFilePath elements with their final destinations
	// {
	//	nameOfVariable:{filePath:['filesWhereToFindIt'], exportedName:'nameUsedInExportThatCanBeUsedForFiltering'}
	// }
	filePathToVars.forEach((exportToLocal, filePath) => {
		if (filePath && exportToLocal) {
			const exportedVariableNames: string[] = []
			exportToLocal.forEach(exportedName => {
				if (exportedName) {
					exportedVariableNames.push(exportedName)
				}
			})
			try {
				const fullFilePath = pathResolver(filePath)
				const source = fs.readFileSync(fullFilePath, {
					encoding: 'utf-8'
				})
				const astRemote = cacher(() => recast.parse(source, { parser: buildParser() }), source)
				const returnedVariables = resolveImmediatelyExported(astRemote, exportedVariableNames)
				exportToLocal.forEach((exported, local) => {
					if (exported && local) {
						const aliasedVariable = returnedVariables[exported]
						if (aliasedVariable) {
							aliasedVariable.filePath = aliasedVariable.filePath.map(p =>
								pathResolver(p, path.dirname(fullFilePath))
							)
							varToFilePath[local] = aliasedVariable
						}
					}
				})
			} catch (e) {
				// ignore load errors
			}
		}
	})
}
