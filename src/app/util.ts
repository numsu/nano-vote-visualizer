export class Util {

	static binarySearchNearestIndex(arr: any[], target: any, lo = 0, hi = arr.length - 1): number {
		if (arr.length == 0) {
			return 0;
		}
		if (target < arr[lo]) {
			return 0;
		}
		if (target > arr[hi]) {
			return hi;
		}

		const mid = Math.floor((hi + lo) / 2);

		return hi - lo < 2
			? (target - arr[lo]) < (arr[hi] - target) ? lo : hi
			: target < arr[mid]
				? Util.binarySearchNearestIndex(arr, target, lo, mid)
				: target > arr[mid]
					? Util.binarySearchNearestIndex(arr, target, mid, hi)
					: mid;
	}

}