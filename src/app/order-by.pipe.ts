import { orderBy } from 'lodash';

import { Pipe, PipeTransform } from "@angular/core";

@Pipe({ name: 'orderBy', pure: false })
export class OrderByPipe implements PipeTransform {

	transform(value: any[], order = '', column: string = ''): any[] {
		if (!value || order === '' || !order) {
			return value;
		}

		if (value.length <= 1) {
			return value;
		}

		if (!column || column === '') {
			if (order === 'asc') {
				return value.sort()
			} else {
				return value.sort().reverse();
			}
		}

		return orderBy(value, [column], [order]);
	}

}