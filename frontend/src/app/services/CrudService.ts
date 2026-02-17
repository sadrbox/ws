import { apiClient } from "./api/client";
import {
	BaseEntity,
	PaginatedResponse,
	PaginationParams,
	FilterParams,
	SortParams,
	ApiErrorResponse,
} from "./api/types";

// 1. ОБЩИЙ ИНТЕРФЕЙС ДЛЯ ВСЕХ CRUD СЕРВИСОВ
export interface ICrudService<T extends BaseEntity> {
	// READ ОПЕРАЦИИ
	getAll(
		pagination?: PaginationParams,
		filters?: FilterParams,
		sort?: SortParams,
	): Promise<PaginatedResponse<T>>;

	getById(id: string | number): Promise<T>;

	getManyByIds(ids: (string | number)[]): Promise<T[]>;

	findOne(filters: FilterParams): Promise<T | null>;

	// CREATE ОПЕРАЦИИ
	create(data: Omit<T, keyof BaseEntity>): Promise<T>;

	createMany(items: Omit<T, keyof BaseEntity>[]): Promise<T[]>;

	// UPDATE ОПЕРАЦИИ
	update(
		id: string | number,
		data: Partial<Omit<T, keyof BaseEntity>>,
	): Promise<T>;

	updateMany(
		ids: (string | number)[],
		data: Partial<Omit<T, keyof BaseEntity>>,
	): Promise<T[]>;

	// DELETE ОПЕРАЦИИ
	delete(id: string | number): Promise<void>;

	deleteMany(ids: (string | number)[]): Promise<void>;

	// ДОПОЛНИТЕЛЬНЫЕ ОПЕРАЦИИ
	count(filters?: FilterParams): Promise<number>;

	search(query: string, fields: (keyof T)[]): Promise<T[]>;

	exists(id: string | number): Promise<boolean>;
}

// 2. БАЗОВЫЙ КЛАСС CRUD СЕРВИСА
export abstract class BaseCrudService<
	T extends BaseEntity,
> implements ICrudService<T> {
	constructor(protected endpoint: string) {}

	// 3. ПОЛУЧЕНИЕ ВСЕХ ЗАПИСЕЙ
	async getAll(
		pagination?: PaginationParams,
		filters?: FilterParams,
		sort?: SortParams,
	): Promise<PaginatedResponse<T>> {
		try {
			// СОБИРАЕМ ПАРАМЕТРЫ ЗАПРОСА
			const params: Record<string, any> = {
				...pagination,
				...filters,
			};

			// ДОБАВЛЯЕМ СОРТИРОВКУ
			if (sort) {
				params.sortBy = sort.field;
				params.sortOrder = sort.direction;
			}

			// ДЕЛАЕМ ЗАПРОС
			const response = await apiClient.get<PaginatedResponse<T>>(
				this.endpoint,
				{ params },
			);

			return response;
		} catch (error) {
			console.error(`[${this.endpoint}] Error in getAll:`, error);
			throw error;
		}
	}

	// 4. ПОЛУЧЕНИЕ ОДНОЙ ЗАПИСИ ПО ID
	async getById(id: string | number): Promise<T> {
		try {
			if (!id) {
				throw new Error("ID is required");
			}

			const response = await apiClient.get<T>(`${this.endpoint}/${id}`);
			return response;
		} catch (error) {
			console.error(`[${this.endpoint}] Error in getById(${id}):`, error);
			throw error;
		}
	}

	// 5. ПОЛУЧЕНИЕ НЕСКОЛЬКИХ ЗАПИСЕЙ ПО ID
	async getManyByIds(ids: (string | number)[]): Promise<T[]> {
		try {
			if (!ids.length) {
				return [];
			}

			const response = await apiClient.post<T[]>(`${this.endpoint}/batch`, {
				ids,
			});
			return response;
		} catch (error) {
			console.error(`[${this.endpoint}] Error in getManyByIds:`, error);
			throw error;
		}
	}

	// 6. ПОИСК ОДНОЙ ЗАПИСИ ПО ФИЛЬТРАМ
	async findOne(filters: FilterParams): Promise<T | null> {
		try {
			const response = await apiClient.get<PaginatedResponse<T>>(
				this.endpoint,
				{
					params: { ...filters, limit: 1 },
				},
			);

			return response.data[0] || null;
		} catch (error) {
			console.error(`[${this.endpoint}] Error in findOne:`, error);
			throw error;
		}
	}

	// 7. СОЗДАНИЕ ЗАПИСИ
	async create(data: Omit<T, keyof BaseEntity>): Promise<T> {
		try {
			// ВАЛИДАЦИЯ ДАННЫХ
			this.validateCreateData(data);

			const response = await apiClient.post<T>(this.endpoint, data);
			return response;
		} catch (error) {
			console.error(`[${this.endpoint}] Error in create:`, error);
			throw error;
		}
	}

	// 8. СОЗДАНИЕ НЕСКОЛЬКИХ ЗАПИСЕЙ
	async createMany(items: Omit<T, keyof BaseEntity>[]): Promise<T[]> {
		try {
			if (!items.length) {
				return [];
			}

			const response = await apiClient.post<T[]>(
				`${this.endpoint}/batch`,
				items,
			);
			return response;
		} catch (error) {
			console.error(`[${this.endpoint}] Error in createMany:`, error);
			throw error;
		}
	}

	// 9. ОБНОВЛЕНИЕ ЗАПИСИ
	async update(
		id: string | number,
		data: Partial<Omit<T, keyof BaseEntity>>,
	): Promise<T> {
		try {
			if (!id) {
				throw new Error("ID is required for update");
			}

			// ВАЛИДАЦИЯ ДАННЫХ
			this.validateUpdateData(data);

			const response = await apiClient.put<T>(`${this.endpoint}/${id}`, data);
			return response;
		} catch (error) {
			console.error(`[${this.endpoint}] Error in update(${id}):`, error);
			throw error;
		}
	}

	// 10. ОБНОВЛЕНИЕ НЕСКОЛЬКИХ ЗАПИСЕЙ
	async updateMany(
		ids: (string | number)[],
		data: Partial<Omit<T, keyof BaseEntity>>,
	): Promise<T[]> {
		try {
			if (!ids.length) {
				return [];
			}

			const response = await apiClient.patch<T[]>(`${this.endpoint}/batch`, {
				ids,
				data,
			});

			return response;
		} catch (error) {
			console.error(`[${this.endpoint}] Error in updateMany:`, error);
			throw error;
		}
	}

	// 11. УДАЛЕНИЕ ЗАПИСИ
	async delete(id: string | number): Promise<void> {
		try {
			if (!id) {
				throw new Error("ID is required for delete");
			}

			await apiClient.delete(`${this.endpoint}/${id}`);
		} catch (error) {
			console.error(`[${this.endpoint}] Error in delete(${id}):`, error);
			throw error;
		}
	}

	// 12. УДАЛЕНИЕ НЕСКОЛЬКИХ ЗАПИСЕЙ
	async deleteMany(ids: (string | number)[]): Promise<void> {
		try {
			if (!ids.length) {
				return;
			}

			await apiClient.delete(`${this.endpoint}/batch`, {
				data: { ids },
			});
		} catch (error) {
			console.error(`[${this.endpoint}] Error in deleteMany:`, error);
			throw error;
		}
	}

	// 13. ПОДСЧЕТ КОЛИЧЕСТВА ЗАПИСЕЙ
	async count(filters?: FilterParams): Promise<number> {
		try {
			const response = await apiClient.get<{ count: number }>(
				`${this.endpoint}/count`,
				{
					params: filters,
				},
			);

			return response.count;
		} catch (error) {
			console.error(`[${this.endpoint}] Error in count:`, error);
			throw error;
		}
	}

	// 14. ПОИСК ПО ТЕКСТУ
	async search(query: string, fields: (keyof T)[]): Promise<T[]> {
		try {
			if (!query.trim()) {
				return [];
			}

			const response = await apiClient.post<T[]>(`${this.endpoint}/search`, {
				query,
				fields,
			});

			return response;
		} catch (error) {
			console.error(`[${this.endpoint}] Error in search:`, error);
			throw error;
		}
	}

	// 15. ПРОВЕРКА СУЩЕСТВОВАНИЯ ЗАПИСИ
	async exists(id: string | number): Promise<boolean> {
		try {
			await this.getById(id);
			return true;
		} catch (error: any) {
			if (error.statusCode === 404) {
				return false;
			}
			throw error;
		}
	}

	// 16. ВАЛИДАЦИЯ ДАННЫХ ПРИ СОЗДАНИИ
	protected validateCreateData(data: Omit<T, keyof BaseEntity>): void {
		// БАЗОВАЯ ВАЛИДАЦИЯ - МОЖНО ПЕРЕОПРЕДЕЛИТЬ В НАСЛЕДНИКАХ
		if (!data || typeof data !== "object") {
			throw new Error("Invalid data: must be an object");
		}
	}

	// 17. ВАЛИДАЦИЯ ДАННЫХ ПРИ ОБНОВЛЕНИИ
	protected validateUpdateData(data: Partial<Omit<T, keyof BaseEntity>>): void {
		if (!data || typeof data !== "object") {
			throw new Error("Invalid data: must be an object");
		}

		if (Object.keys(data).length === 0) {
			throw new Error("No data provided for update");
		}
	}

	// 18. ПОСТРОЕНИЕ QUERY STRING
	protected buildQueryString(params: Record<string, any>): string {
		const searchParams = new URLSearchParams();

		Object.entries(params).forEach(([key, value]) => {
			if (value !== undefined && value !== null && value !== "") {
				if (Array.isArray(value)) {
					value.forEach((v) => searchParams.append(`${key}[]`, String(v)));
				} else if (typeof value === "object") {
					searchParams.append(key, JSON.stringify(value));
				} else {
					searchParams.append(key, String(value));
				}
			}
		});

		const queryString = searchParams.toString();
		return queryString ? `?${queryString}` : "";
	}
}

// 19. КОНКРЕТНЫЙ CRUD СЕРВИС
export class CrudService<T extends BaseEntity> extends BaseCrudService<T> {
	constructor(endpoint: string) {
		super(endpoint);
	}
}
