import { CrudService } from "./CrudService";
import { User, Product, Order, BaseEntity } from "./api/types";

// 1. СОЗДАНИЕ КОНКРЕТНЫХ СЕРВИСОВ
const userService = new CrudService<User>("/users");
const productService = new CrudService<Product>("/products");
const orderService = new CrudService<Order>("/orders");

// 2. РЕЕСТР ВСЕХ СЕРВИСОВ
export const serviceRegistry = {
	users: userService,
	products: productService,
	orders: orderService,
} as const;

// 3. ТИП ДЛЯ КЛЮЧЕЙ СЕРВИСОВ
export type ServiceKey = keyof typeof serviceRegistry;

// 4. ФУНКЦИЯ ДЛЯ ПОЛУЧЕНИЯ СЕРВИСА
export function getService<K extends ServiceKey>(
	key: K,
): (typeof serviceRegistry)[K] {
	const service = serviceRegistry[key];

	if (!service) {
		throw new Error(`Service "${key}" not found in registry`);
	}

	return service;
}

// 5. ДИНАМИЧЕСКОЕ СОЗДАНИЕ СЕРВИСА
export function createService<T extends BaseEntity>(
	endpoint: string,
): CrudService<T> {
	return new CrudService<T>(endpoint);
}

// 6. КЛАСС-ФАБРИКА ДЛЯ УПРАВЛЕНИЯ СЕРВИСАМИ
export class ServiceFactory {
	private static instances: Map<string, CrudService<any>> = new Map();

	// ПОЛУЧЕНИЕ СЕРВИСА (SINGLETON)
	static getService<T extends BaseEntity>(endpoint: string): CrudService<T> {
		// ЕСЛИ СЕРВИС УЖЕ СОЗДАН - ВОЗВРАЩАЕМ ЕГО
		if (this.instances.has(endpoint)) {
			return this.instances.get(endpoint)!;
		}

		// СОЗДАЕМ НОВЫЙ СЕРВИС
		const service = new CrudService<T>(endpoint);
		this.instances.set(endpoint, service);

		return service;
	}

	// ОЧИСТКА ВСЕХ СЕРВИСОВ
	static clearAll(): void {
		this.instances.clear();
	}

	// УДАЛЕНИЕ КОНКРЕТНОГО СЕРВИСА
	static removeService(endpoint: string): boolean {
		return this.instances.delete(endpoint);
	}

	// ПОЛУЧЕНИЕ СПИСКА ВСЕХ СЕРВИСОВ
	static getAllServices(): Array<{
		endpoint: string;
		service: CrudService<any>;
	}> {
		return Array.from(this.instances.entries()).map(([endpoint, service]) => ({
			endpoint,
			service,
		}));
	}
}
