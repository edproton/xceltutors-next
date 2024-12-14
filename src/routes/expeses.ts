import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const expenseSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(3).max(100),
  amount: z.number().int().positive(),
});

const createExpenseSchema = expenseSchema.omit({ id: true });

type Expense = z.infer<typeof expenseSchema>;

const fakeExpenses: Expense[] = [
  {
    id: 1,
    title: "Groceries",
    amount: 50,
  },
  {
    id: 2,
    title: "Utilities",
    amount: 100,
  },
  {
    id: 3,
    title: "Rent",
    amount: 1599,
  },
];

export const expensesRoute = new Hono()
  .get("/", (c) => {
    return c.json(
      {
        expenses: fakeExpenses,
      },
      200
    );
  })
  .post("/", zValidator("json", createExpenseSchema), async (c) => {
    const expense = c.req.valid("json");
    const newExpense: Expense = {
      ...expense,
      id: fakeExpenses.length + 1,
    };
    fakeExpenses.push(newExpense);
    return c.json(newExpense, 201);
  })
  .get("/total-spent", async (c) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const totalSpent = fakeExpenses.reduce(
      (sum, expense) => sum + expense.amount,
      0
    );
    return c.json({ total: totalSpent }, 200);
  })
  .get("/:id{[0-9]+}", (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const expense = fakeExpenses.find((exp) => exp.id === id);

    if (!expense) {
      return c.json({ error: "Expense not found" }, 404);
    }

    return c.json(expense, 200);
  })
  .delete("/:id{[0-9]+}", (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const expenseIndex = fakeExpenses.findIndex((exp) => exp.id === id);

    if (expenseIndex === -1) {
      return c.json({ error: "Expense not found" }, 404);
    }

    const [deletedExpense] = fakeExpenses.splice(expenseIndex, 1);
    return c.json(deletedExpense);
  });
