export class Util {

	static binarySearchNearestIndex(arr: any[], property: string, target: any, lo?, hi = arr.length - 1): number {
		if (!lo) {
			arr.some((_, i) => (lo = i, true));
		}
		if (arr.length == 0) {
			return 0;
		}
		if (target < arr[lo][property]) {
			return 0;
		}
		if (target > arr[hi][property]) {
			return hi;
		}

		const mid = Math.floor((hi + lo) / 2);

		return hi - lo < 2
			? (target - arr[lo][property]) < (arr[hi][property] - target) ? lo : hi
			: target < arr[mid][property]
				? Util.binarySearchNearestIndex(arr, property, target, lo, mid)
				: target > arr[mid][property]
					? Util.binarySearchNearestIndex(arr, property, target, mid, hi)
					: mid;
	}

	static lerp(min: number, max: number, interpolation: number): number {
		return min * (1 - interpolation) + max * interpolation
	}

}