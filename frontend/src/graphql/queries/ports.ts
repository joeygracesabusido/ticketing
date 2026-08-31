import { gql } from "@apollo/client"

export const PORTS = gql`
  query Ports {
    ports {
      id
      code
      name
      city
      province
      country
      active
    }
  }
`
