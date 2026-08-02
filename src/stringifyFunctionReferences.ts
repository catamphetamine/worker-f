// This source code was originally copy-pasted from `fflate`'s `wcln` function
// and then refactored according to my personal taste. Also added comments.
// https://github.com/101arrowz/fflate/blob/master/src/index.ts

import type { GetDependencies } from './createWorker.ts'

/**
 * In a given list of dependencies, it stringifies any functions to their javascript source code strings.
 * It could've used simple `.toString()` if it wasn't for "minification" process which eventually renames
 * all functions to random shortened names. Why do function names matter? Because the worker will have to
 * call those functions by name rather than by reference, because a worker can't share any runtime code
 * with the parent thread, hence the stringification to javascript source code.
 *
 * Alternatively, the code that is executed inside a worker could abstain from using global function references
 * and instead reference any functions from some kind of a `context` object. In that case, minifiers
 * won't touch the property names in that `context` object. The "pros" would be not having to use this "magic" function.
 * The "cons" would be having to prepend the `context.` prefix to every function being called,
 * and if any of those functions happen to call another functions, those would have to be called
 * from the `context` too, which could quickly turn the code into a context-passing "spaghetti" mess.
 * Not to mention having to define the `Context` type in case of TypeScript.
 * But otherwise, both approaches would work and there's no other difference between them.
 *
 * @param {function} getDependencies — Returns an array of dependencies. This function must adhere to a strict form: it has to be a "closure" that returns an array of named variables. The restriction is because the exact variable names have to be known from the stringified form of this function.
 * @returns {object} — An object of shape: `{ functions, values }` where `functions` contains the source code of any functions by their actual name, and `values` contains any "regular values" — strings, numbers, objects, arrays, etc — in their original (non-stringified) form.
 */
export default function stringifyFunctionReferences(getDependencies: GetDependencies) {
	const functions: Record<string, string> = {}
	const variables: Record<string, unknown> = {}

	const references = getDependencies()
	const getReferencesSourceCode = getDependencies.toString()
	const referencedNames = getReferencesSourceCode.slice(getReferencesSourceCode.indexOf('[') + 1, getReferencesSourceCode.lastIndexOf(']')).replace(/\s+/g, '').split(',')

	let i = 0
	while (i < references.length) {
		let name = referencedNames[i]
		let value = references[i]
		if (typeof value === 'function') {
			functions[name] = getFunctionSourceCode(value, name)
		} else {
			// Regular values don't need to be stringified because they could be just "cloned".
			variables[name] = value
		}
		i++
	}

	return {
		functions,
		variables
	}
}

/**
 * Returns the source code for a function or a class.
 *
 * For non-"native" classes, the end result will depend on the name of the class,
 * which should be passed as a second argument for that reason. Specifically,
 * the name of the class will be used when defining its `prototype` properties.
 *
 * "Native" functions or classes will be stringified to their "native" global name.
 * For example, a reference to `ArrayBuffer` will be stringified as `"ArrayBuffer"`.
 *
 * @param {function} func
 * @param {string} name
 * @returns {string}
 */
function getFunctionSourceCode(func: Function, name: string) {
	const funcSourceCode = func.toString()
	// If the "function" is actually not a function but rather a class definition
	// then it should also replace the class name in the definition of any of its methods.
	if (func.prototype) {
		// "Native" classes don't have javascript source code because they're written in C++, etc.
		// In such case, the source code for such class could be replaced with the class name itself,
		// because "native" classes are globally available everywhere and printing a "native" class name
		// is evaluated as the definition of such class, so there's no need to pass the definition as source code.
		if (funcSourceCode.indexOf('[native code]') >= 0) {
			// `funcSourceCode` example: "function DOMParser() { [native code] }"
			const funcNameStartsAt = funcSourceCode.indexOf(' ', 'function'.length) + ' '.length
			const funcNameEndsBefore = funcSourceCode.indexOf('(', funcNameStartsAt)
			return funcSourceCode.slice(funcNameStartsAt, funcNameEndsBefore)
		} else {
			// The code of non-"native" classes will have to include the source code
			// of all their `prototype` properties.
			let code = funcSourceCode
			for (const key in func.prototype) {
				// Sidenote: For `TextDecoder` global class in Node.js, I saw it output a "weird" error
				// `TypeError: Value of "this" must be of type TextDecoder`  when attempting to read `func.prototype["encoding"]`.
				// Perhaps that's because the `encoding` property of `TextDecoder` is a "getter"
				// rather than a property, and that "getter" function relies on `this` being `TextDecoder`:
				// `get encoding() { return this.#encoding; }`.
				code += ';' + name + '.prototype.' + key + '=' + func.prototype[key].toString()
			}
			return code
		}
	} else {
		return funcSourceCode
	}
}