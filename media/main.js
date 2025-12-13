// @ts-check

// This script is run within the webview itself
(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();

	class ArrEntry {
		/** @type {string} */ type;
		/** @type {string} */ value;
		constructor(/** @type {string} */ type, /** @type {string} */ value) {
			this.type = type;
			this.value = value;
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
		/** @type {HTMLSelectElement} */ addingTypeSelect;
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
			this.addingTypeSelect = parent.querySelector('tfoot tr :nth-child(2) select');
			// @ts-ignore
			this.addingButton = parent.querySelector('#arr-button-add-entry');

			this.addingButton.addEventListener('click', () => {
				vscode.postMessage({
					type: 'add-entry',
					data: { type: Number(this.addingTypeSelect.selectedOptions[0].value) },
				});
			});
		}

		static _types = [
			{ name: 'INTEGER', value: '1' },
			{ name: 'STRING', value: '2' },
			{ name: 'BOOL', value: '3' },
			{ name: 'DOUBLE', value: '4' },
		];

		static _createTypeSelect() {
			const typeSelect = document.createElement('select');
			for (const { name, value } of ArrEditor._types) {
				typeSelect.appendChild(new Option(name, value));
			}
			typeSelect.classList.add('vscode-select');
			return typeSelect;
		}

		_redraw() {
			for (let i = 0; i < Math.min(this.mainTableBody.children.length, this.entries.length); i++) {
				// @ts-ignore
				const /** @type {HTMLTableCellElement[]} */ [indexCell, typeCell, valueCell] = [...this.mainTableBody.children[i].children];
				// @ts-ignore
				const /** @type {HTMLSelectElement} */ typeSelect = typeCell.children[0];
				indexCell.innerText = i.toString();
				// @ts-ignore
				typeSelect.value = this.entries[i].type;
				valueCell.innerText = this.entries[i].value;
			}
			for (let i = this.mainTableBody.children.length; i < this.entries.length; i++) {
				const typeSelect = ArrEditor._createTypeSelect();
				typeSelect.addEventListener('input', () => {
					vscode.postMessage({
						type: 'set-type',
						data: {
							index: i,
							type: typeSelect.selectedOptions[0].value,
						},
					});
				});
				
				const indexCell = document.createElement('td');
				const typeCell = document.createElement('td');
				const valueCell = document.createElement('td');
				indexCell.innerText = i.toString();
				typeCell.appendChild(typeSelect);
				valueCell.innerText = this.entries[i].value;
				valueCell.contentEditable = 'plaintext-only';
				valueCell.addEventListener('blur', () => {
					vscode.postMessage({
						type: 'set-value',
						data: {
							index: i,
							value: valueCell.innerText,
						},
					});
				});
				valueCell.addEventListener('keydown', e => {
					if (e.key === 'Enter') {
						valueCell.blur();
					}
				});

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
				const entries = body.entries;
				await editor.reset(entries);
			}
			case 'update': {
				const entries = body.entries;
				await editor.reset(entries);
				return;
			}
		}
	});

	// Signal to VS Code that the webview is initialized.
	vscode.postMessage({ type: 'ready' });
}());
