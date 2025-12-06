// @ts-check

// This script is run within the webview itself
(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();

	class ArrEntry {
		type;
		value;

		constructor(/** @type {string} */ type, /** @type { string | number | boolean | null | undefined } */ value = undefined) {
			this.type = type;
			this.value = value ?? '';
			this.switchType(type);
		}

		switchType(/** @type {string} */ type) {
			switch (type) {
				case 'int': {
					switch (typeof this.value) {
						case 'number': {
							this.value = Math.trunc(this.value);
							break;
						}
						case 'boolean': {
							this.value = this.value ? 1 : 0;
							break;
						}
						case 'string': {
							this.value = parseInt(this.value);
							if (isNaN(this.value)) {
								this.value = 0;
							}
							break;
						}
					}
					break;
				}
				case 'string': {
					this.value = this.stringValue;
					break;
				}
				case 'bool': {
					switch (typeof this.value) {
						case 'number': {
							this.value = this.value == 1;
							break;
						}
						case 'string': {
							this.value = this.value == '1' || this.value.toUpperCase().trim() == 'TRUE';
							break;
						}
					}
					break;
				}
				case 'double': {
					switch (typeof this.value) {
						case 'boolean': {
							this.value = this.value ? 1 : 0;
							break;
						}
						case 'string': {
							this.value = parseFloat(this.value);
							if (isNaN(this.value)) {
								this.value = 0;
							}
							break;
						}
					}
					break;
				}
				default: {
					throw new Error('Bad type');
				}
			}

			this.type = type;
		}

		get stringValue() {
			if (typeof this.value === 'number') {
				return this.type === 'double' ? this.value.toFixed(4) : this.value.toString();
			}
			if (typeof this.value === 'boolean') {
				return this.value ? 'TRUE' : 'FALSE';
			}
			return this.value;
		}
	}

	class ArrEditor {
		ready;
		editable;
		/** @type {ArrEntry[]} */ entries;

		// @ts-ignore
		/** @type {HTMLTableSectionElement} */ mainTableBody;
		// @ts-ignore
		/** @type {HTMLTableCellElement} */ addingIndexCell;
		// @ts-ignore
		/** @type {HTMLTableCellElement} */ addingTypeCell;
		// @ts-ignore
		/** @type {HTMLButtonElement} */ addingButton;

		constructor( /** @type {HTMLElement?} */ parent) {
			if (!parent) {
				throw new Error('Parent must exist');
			}

			this.ready = false;
			this.editable = false;
			this.entries = [];

			this._initElements(parent);
		}

		setEditable(/** @type {boolean} */ editable) {
			this.editable = editable;
			const colorButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.drawing-controls button'));
			for (const colorButton of colorButtons) {
				colorButton.disabled = !editable;
			}
		}

		_initElements(/** @type {HTMLElement} */ parent) {
			// @ts-ignore
			this.mainTableBody = parent.querySelector('tbody');
			// @ts-ignore
			this.addingIndexCell = parent.querySelector('tfoot tr :nth-child(1)');
			// @ts-ignore
			this.addingTypeCell = parent.querySelector('tfoot tr :nth-child(2)');
			// @ts-ignore
			this.addingButton = parent.querySelector('#arr-button-add-entry');

			this.addingButton.addEventListener('click', () => {
				const newEntry = new ArrEntry(this.addingTypeCell.innerText);
				vscode.postMessage({
					type: 'add-entry',
					data: newEntry,
				});
			});
		}

		_redraw() {
			for (let i = 0; i < Math.min(this.mainTableBody.children.length, this.entries.length); i++) {
				// @ts-ignore
				const /** @type {HTMLTableCellElement[]} */ [indexCell, typeCell, valueCell] = [...this.mainTableBody.children[i].children];
				indexCell.innerText = i.toString();
				typeCell.innerText = this.entries[i].type;
				valueCell.innerText = this.entries[i].stringValue;
			}
			for (let i = this.mainTableBody.children.length; i < this.entries.length; i++) {
				const indexCell = document.createElement('td');
				const typeCell = document.createElement('td');
				const valueCell = document.createElement('td');
				indexCell.innerText = i.toString();
				typeCell.innerText = this.entries[i].type;
				valueCell.innerText = this.entries[i].stringValue;

				const row = document.createElement('tr');
				row.appendChild(indexCell);
				row.appendChild(typeCell);
				row.appendChild(valueCell);

				this.mainTableBody.appendChild(row);
			}
			for (let i = this.mainTableBody.children.length - 1; i >= this.entries.length; i--) {
				this.mainTableBody.removeChild(this.mainTableBody.children[i]);
			}
			this.addingIndexCell.innerText = this.entries.length.toString();
			this.addingTypeCell.innerText = 'string';
		}

		/**
		 * @param {Array<ArrEntry> | undefined} entries
		 */
		async reset(entries = []) {
			this.entries = entries;
			this._redraw();
		}
	}

	const editor = new ArrEditor(document.querySelector('#arr-table-main'));

	// Handle messages from the extension
	window.addEventListener('message', async e => {
		const { type, body } = e.data;
		switch (type) {
			case 'init': {
				editor.setEditable(body.editable);
				const entries = body.entries.map((/** @type {{ type: string, value: string | number | boolean }} */ e) => new ArrEntry(e.type, e.value));
				await editor.reset(entries);
			}
			case 'update': {
				const entries = body.entries.map((/** @type {{ type: string, value: string | number | boolean }} */ e) => new ArrEntry(e.type, e.value));
				await editor.reset(entries);
				return;
			}
		}
	});

	// Signal to VS Code that the webview is initialized.
	vscode.postMessage({ type: 'ready' });
}());
