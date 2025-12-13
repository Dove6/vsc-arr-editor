import { BinaryBuffer, createGrowableDataView } from '../utils';
import { encode } from 'iconv-lite';

const decoder = new TextDecoder('windows-1250');
const encoder = {
	encode: (input: string) => encode(input, 'windows-1250')
};

export type ArrEntry = bigint | string | boolean | number;

export enum ValueType {
	INTEGER = 1,
	STRING = 2,
	BOOL = 3,
	DOUBLE = 4,
}

export const getValueType = (entry: ArrEntry) => {
	switch (typeof(entry)) {
		case 'bigint': {
			return ValueType.INTEGER;
		}
		case 'string': {
			return ValueType.STRING;
		}
		case 'boolean': {
			return ValueType.BOOL;
		}
		case 'number': {
			return ValueType.DOUBLE;
		}
		default: {
			throw new Error(`Non-serializable type used: ${typeof(entry)}`);
		}
	}
};

export const deserializeArray = (data: ArrayBufferLike) => {
	const buffer = new BinaryBuffer(new DataView(data));
	const count = buffer.getUint32();

	const entries: ArrEntry[] = [];
	for (let i = 0; i < count; ++i) {
		const type = buffer.getUint32();

		switch (type) {
			case ValueType.INTEGER: {
				entries.push(BigInt(buffer.getInt32()));
				break;
			}
			case ValueType.STRING: {
				const length = buffer.getUint32();
				entries.push(decoder.decode(buffer.read(length) as ArrayBuffer));
				break;
			}
			case ValueType.BOOL: {
				entries.push(buffer.getUint32() === 1);
				break;
			}
			case ValueType.DOUBLE: {
				entries.push(buffer.getInt32() / 10000);
				break;
			}
			default: {
				throw new Error(`Unknown ARR entry type: ${type}`);
			}
		}
	}
	return entries;
};

export const serializeArray = (data: ArrEntry[]) => {
	const view = createGrowableDataView();
	const buffer = new BinaryBuffer(view);

	buffer.setUint32(data.length);

	for (const entry of data) {
		switch (typeof(entry)) {
			case 'bigint': {
				buffer.setUint32(ValueType.INTEGER);
				buffer.setInt32(Number(entry));
				break;
			}
			case 'string': {
				buffer.setUint32(ValueType.STRING);
				buffer.setUint32(entry.length);
				buffer.write(encoder.encode(entry));
				break;
			}
			case 'boolean': {
				buffer.setUint32(ValueType.BOOL);
				buffer.setUint32(Number(entry));
				break;
			}
			case 'number': {
				buffer.setUint32(ValueType.DOUBLE);
				buffer.setInt32(entry * 10000);
				break;
			}
			default: {
				throw new Error(`Non-serializable type used: ${typeof(entry)}`);
			}
		}
	}

	return new Uint8Array(view.internalBuffer);
};
