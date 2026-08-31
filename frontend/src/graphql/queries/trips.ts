import { gql } from "@apollo/client"

export const SEARCH_TRIPS = gql`
  query SearchTrips($originPortId: String!, $destinationPortId: String!, $departureDate: Date!) {
    searchTrips(originPortId: $originPortId, destinationPortId: $destinationPortId, departureDate: $departureDate) {
      id
      departureAt
      arrivalAt
      status
      fareFrom
      route {
        id
        code
        originPort {
          id
          code
          name
          city
        }
        destinationPort {
          id
          code
          name
          city
        }
        estimatedDurationMinutes
      }
      vessel {
        id
        code
        name
        status
      }
      departurePort {
        id
        code
        name
        city
      }
      arrivalPort {
        id
        code
        name
        city
      }
    }
  }
`

export const GET_TRIP = gql`
  query GetTrip($id: String!) {
    trip(id: $id) {
      id
      departureAt
      arrivalAt
      status
      fareFrom
      bookingOpen
      bookingClose
      route {
        id
        code
        originPort {
          id
          code
          name
          city
        }
        destinationPort {
          id
          code
          name
          city
        }
        distanceKm
        estimatedDurationMinutes
      }
      vessel {
        id
        code
        name
        capacity
        status
      }
      departurePort {
        id
        code
        name
        city
      }
      arrivalPort {
        id
        code
        name
        city
      }
    }
  }
`
