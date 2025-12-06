import { BinaryBuffer, createGrowableDataView } from '../utils'
import { ArrEntry } from '../../arrEditor'
import { encode } from 'iconv-lite'

const decoder = new TextDecoder('windows-1250')
const encoder = {
	encode: (input: string) => encode(input, 'windows-1250')
}

enum ValueType {
	INTEGER = 1,
	FLOAT = 4,
	STRING = 2,
	BOOLEAN = 3,
}

export const deserializeArray = (data: ArrayBufferLike) => {
	const buffer = new BinaryBuffer(new DataView(data))
	const count = buffer.getUint32()

	const entries: ArrEntry[] = []
	for (let i = 0; i < count; ++i) {
		const type = buffer.getUint32()

		switch (type) {
			case ValueType.INTEGER:
				entries.push({ type: 'int', value: buffer.getInt32() })
				break
			case ValueType.STRING: {
				const length = buffer.getUint32()
				entries.push({ type: 'string', value: decoder.decode(buffer.read(length) as ArrayBuffer) })
				break
			}
			case ValueType.BOOLEAN:
				entries.push({ type: 'bool', value: buffer.getUint32() === 1 })
				break
			case ValueType.FLOAT:
				entries.push({ type: 'double', value: buffer.getInt32() / 10000 })
				break
		}
	}
	return entries
}

export const serializeArray = (data: ArrEntry[]) => {
    const view = createGrowableDataView()
    const buffer = new BinaryBuffer(view)

	buffer.setUint32(data.length)

	for (const entry of data) {
		switch (entry.type) {
			case 'int': {
				buffer.setUint32(ValueType.INTEGER);
				buffer.setInt32(entry.value);
				break;
			}
			case 'string': {
				buffer.setUint32(ValueType.STRING);
				buffer.setUint32(entry.value.length);
				buffer.write(encoder.encode(entry.value));
				break;
			}
			case 'bool': {
				buffer.setUint32(ValueType.BOOLEAN);
				buffer.setUint32(entry.value ? 1 : 0);
				break;
			}
			case 'double': {
				buffer.setUint32(ValueType.FLOAT);
				buffer.setInt32(entry.value * 10000);
				break;
			}
		}
	}

	return new Uint8Array(view.internalBuffer)
}
