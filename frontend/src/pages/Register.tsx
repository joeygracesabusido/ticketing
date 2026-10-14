import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Header } from "@/components/layout/Header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Link, useNavigate } from "react-router-dom"
import { supabase, missingSupabaseEnvMessage } from "@/lib/supabase"

const registerSchema = z.object({
  firstName: z.string().min(1, "Enter first name"),
  lastName: z.string().min(1, "Enter last name"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "Min 6 characters"),
})

type RegisterForm = z.infer<typeof registerSchema>

export function Register() {
  const navigate = useNavigate()
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) })

  const onSubmit = async (values: RegisterForm) => {
    setError(null)
    setNotice(null)
    if (!supabase) {
      setError(missingSupabaseEnvMessage)
      return
    }
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: { first_name: values.firstName, last_name: values.lastName } },
    })
    if (error) {
      setError(error.message)
      return
    }
    if (data.session) navigate("/")
    else setNotice("Account created — check your email to confirm, then login.")
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-12 flex justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Register</CardTitle>
            <CardDescription>Create a new account to book ferry trips</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input id="firstName" placeholder="Juan" {...register("firstName")} />
                  {errors.firstName && <p className="text-sm text-destructive">{errors.firstName.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input id="lastName" placeholder="Dela Cruz" {...register("lastName")} />
                  {errors.lastName && <p className="text-sm text-destructive">{errors.lastName.message}</p>}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="you@example.com" {...register("email")} />
                {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="••••••••" {...register("password")} />
                {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
              <Button className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Account"}
              </Button>
            </form>
            <p className="text-sm text-center text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Login
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

export default Register
